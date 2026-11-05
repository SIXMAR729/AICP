// src/client.test.ts — AICPClient + webhook handler, end to end with real signatures.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AICPClient, AICPError, generateSigningKey, signingKeyFromPrivateJwk, createWebhookHandler,
  verifyRequestSignature, signMessage, WEBHOOK_SIGNATURE_COMPONENTS, WebhookOrderTracker,
} from './index';

type Captured = { url: string; init: RequestInit };

function mockFetch(responses: Array<{ status?: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: Captured[] = [];
  const fetchImpl = async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    const next = responses.shift() ?? { body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status ?? 200, headers: next.headers });
  };
  return { calls, fetchImpl };
}

test('discover() uses published endpoint templates and strips {?query} expansions', async () => {
  const { calls, fetchImpl } = mockFetch([
    { body: { protocol: 'AICP', version: '1.0', endpoints: { store_contract: 'https://shop.example/x/{storeId}/schema{?intent}' } } },
    { body: { version: '1.0', intent: 'order' } },
  ]);
  const client = new AICPClient({ baseUrl: 'https://shop.example', fetch: fetchImpl });
  await client.discover();
  await client.getOrderSchema('store-1', 'booking');
  assert.equal(calls[1].url, 'https://shop.example/x/store-1/schema?intent=booking');
});

test('createOrder sends Bearer + Idempotency-Key and a signature the platform verifies', async () => {
  const key = generateSigningKey();
  const { calls, fetchImpl } = mockFetch([{ status: 201, body: { order_id: 'o1', status: 'pending_confirmation', total: 120 } }]);
  const client = new AICPClient({ baseUrl: 'https://shop.example', apiKey: 'k_live', signingKey: key, fetch: fetchImpl });
  const result = await client.createOrder('s1', { intent: 'order', items: [{ id: 'm1', quantity: 2 }] }, 'retry-key-0001');
  assert.equal(result.order_id, 'o1');

  const { url, init } = calls[0];
  const headers = new Headers(init.headers);
  assert.equal(headers.get('authorization'), 'Bearer k_live');
  assert.equal(headers.get('idempotency-key'), 'retry-key-0001');
  const verified = verifyRequestSignature({ method: 'POST', url, headers, body: String(init.body), jwk: key.publicJwk, kid: key.kid });
  assert.deepEqual(verified.ok, true);
  assert.match(headers.get('signature-input') ?? '', /"idempotency-key"/);
});

test('updateSettings rotation signs with current AND new key, then switches keys', async () => {
  const current = generateSigningKey(), next = generateSigningKey('Ed25519');
  const { calls, fetchImpl } = mockFetch([{ body: { success: true } }, { body: { agent_id: 'a1' } }]);
  const client = new AICPClient({ baseUrl: 'https://shop.example', apiKey: 'k', signingKey: current, fetch: fetchImpl });
  await client.updateSettings('s1', { newSigningKey: next });
  const first = new Headers(calls[0].init.headers);
  assert.match(first.get('signature-input') ?? '', /^sig1=.*, sig2=/);
  for (const key of [current, next]) {
    const ok = verifyRequestSignature({ method: 'POST', url: calls[0].url, headers: first, body: String(calls[0].init.body), jwk: key.publicJwk, kid: key.kid });
    assert.equal(ok.ok, true, `signature by ${key.kid}`);
  }
  await client.me('s1');
  assert.match(new Headers(calls[1].init.headers).get('signature-input') ?? '', new RegExp(`keyid="${next.kid}"`));
});

test('errors become AICPError with code, status and Retry-After', async () => {
  const { fetchImpl } = mockFetch([{ status: 429, body: { error: 'RATE_LIMIT_EXCEEDED' }, headers: { 'retry-after': '7' } }]);
  const client = new AICPClient({ baseUrl: 'https://shop.example', apiKey: 'k', fetch: fetchImpl });
  await assert.rejects(client.getOrder('s1', 'o1'), (error: unknown) => {
    assert.ok(error instanceof AICPError);
    assert.equal(error.code, 'RATE_LIMIT_EXCEEDED');
    assert.equal(error.status, 429);
    assert.equal(error.retryAfterSeconds, 7);
    assert.equal(error.retryable, true);
    return true;
  });
});

test('client refuses plain http, path injection and bad idempotency keys', async () => {
  assert.throws(() => new AICPClient({ baseUrl: 'http://shop.example' }));
  const client = new AICPClient({ baseUrl: 'https://shop.example', apiKey: 'k', fetch: mockFetch([]).fetchImpl });
  await assert.rejects(client.getOrder('s1', '../admin'));
  await assert.rejects(client.createOrder('s1', { items: [] }, 'short'));
});

test('signingKeyFromPrivateJwk round-trips a stored key', () => {
  const key = generateSigningKey();
  assert.equal(signingKeyFromPrivateJwk(key.privateJwk).kid, key.kid);
});

function signedWebhook(platformKey: ReturnType<typeof generateSigningKey>, body: unknown, url = 'https://agent.example/hooks/aicp') {
  const raw = JSON.stringify(body);
  const headers = new Headers({ 'content-type': 'application/json', 'webhook-id': (body as { id: string }).id });
  const added = signMessage({ method: 'POST', url, headers, body: raw, privateJwk: platformKey.privateJwk, kid: platformKey.kid,
    components: [...WEBHOOK_SIGNATURE_COMPONENTS] });
  for (const [k, v] of Object.entries(added)) headers.set(k, v);
  return new Request(url, { method: 'POST', headers, body: raw });
}

test('webhook handler: challenge, verify, dedupe, order, retry after failure', async () => {
  const platformKey = generateSigningKey();
  const keys = [{ ...platformKey.publicJwk, kid: platformKey.kid, use: 'sig', alg: 'ES256' }];
  const applied: string[] = [];
  let fail = false;
  const handle = createWebhookHandler({ keys, tracker: new WebhookOrderTracker(), onEvent: (event) => {
    if (fail) throw new Error('db down');
    applied.push(`${event.id}:${event.data.order_version}`);
  } });

  const challenge = await handle(signedWebhook(platformKey, { id: 'v1', type: 'webhook.verification', api_version: 'x', created_at: '', data: { agent_id: null, challenge: 'abc' } }));
  assert.deepEqual(await challenge.json(), { challenge: 'abc' });

  const event = (id: string, version: number) => ({ id, type: 'order.updated', api_version: 'x', created_at: '', data: {
    order_id: 'o1', store_id: 's1', status: 'ready', previous_status: null, current_status: 'ready', order_version: version,
    occurred_at: null, total: 1, currency: 'THB', updated_at: '', tracking_url: null } });

  fail = true;
  assert.equal((await handle(signedWebhook(platformKey, event('e2', 2)))).status, 500);
  fail = false;
  assert.equal((await handle(signedWebhook(platformKey, event('e2', 2)))).status, 204); // retry applied
  assert.equal((await handle(signedWebhook(platformKey, event('e2', 2)))).status, 204); // duplicate dropped
  assert.equal((await handle(signedWebhook(platformKey, event('e1', 1)))).status, 204); // older version dropped
  assert.deepEqual(applied, ['e2:2']);

  const forged = signedWebhook(generateSigningKey(), event('e3', 3));
  assert.equal((await handle(forged)).status, 401);
});
