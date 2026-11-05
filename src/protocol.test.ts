import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  parsePublicSigningJwk, signMessage, verifyRequestSignature, requiredRequestComponents, contentDigestMatches,
  isValidIdempotencyKey, WebhookOrderTracker, verifyWebhookSignature, WEBHOOK_SIGNATURE_COMPONENTS,
  webhookVerificationResponse, type WebhookEvent,
} from './index';

function keypair(kind: 'ec' | 'ed') {
  const { privateKey } = kind === 'ec' ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }) : crypto.generateKeyPairSync('ed25519');
  const privateJwk = privateKey.export({ format: 'jwk' });
  const { d: _d, ...publicJwk } = privateJwk;
  const parsed = parsePublicSigningJwk(publicJwk)!;
  return { privateJwk, publicJwk, ...parsed };
}
const url = 'https://platform.example/api/v1/commerce/store/s/orders';

function signedRequest(key: ReturnType<typeof keypair>, body = '{"items":[]}', extra: Record<string, string> = {}) {
  const headers = new Headers({ 'content-type': 'application/json', 'idempotency-key': 'k-12345678', ...extra });
  const message = { method: 'POST', url, headers };
  const added = signMessage({ ...message, body, privateJwk: key.privateJwk, kid: key.kid, components: requiredRequestComponents(message, true) });
  for (const [name, value] of Object.entries(added)) headers.set(name, value);
  return { ...message, body };
}

describe('request signatures (spec §4)', () => {
  it('ES256 and Ed25519 round-trip; keyid is the RFC 7638 thumbprint', () => {
    for (const key of [keypair('ec'), keypair('ed')]) {
      assert.equal(verifyRequestSignature({ ...signedRequest(key), jwk: key.jwk, kid: key.kid }).ok, true);
    }
  });
  it('rejects tampering, foreign keys, stale signatures and private JWKs', () => {
    const a = keypair('ec'), b = keypair('ed');
    const message = signedRequest(a);
    assert.equal(verifyRequestSignature({ ...message, body: '{"items":[1]}', jwk: a.jwk, kid: a.kid }).ok, false);
    assert.equal(verifyRequestSignature({ ...message, jwk: b.jwk, kid: b.kid }).ok, false);
    assert.equal(verifyRequestSignature({ ...message, jwk: a.jwk, kid: a.kid, nowSeconds: Math.floor(Date.now() / 1000) + 301 }).ok, false);
    assert.equal(parsePublicSigningJwk(a.privateJwk), null);
  });
  it('covers content-type with a body and reads Content-Digest as a dictionary', () => {
    assert.deepEqual(requiredRequestComponents({ method: 'POST', url, headers: new Headers() }, true),
      ['@method', '@authority', '@path', 'content-digest', 'content-type']);
    const body = 'x', s256 = crypto.createHash('sha256').update(body).digest('base64'), s512 = crypto.createHash('sha512').update(body).digest('base64');
    assert.equal(contentDigestMatches(`sha-512=:${s512}:, sha-256=:${s256}:`, body), true);
    assert.equal(contentDigestMatches(`sha-512=:${s512}:`, body), false);
  });
});

describe('protocol helpers (spec §5, §7)', () => {
  it('validates Idempotency-Key format', () => {
    assert.equal(isValidIdempotencyKey(crypto.randomUUID()), true);
    assert.equal(isValidIdempotencyKey('short'), false);
    assert.equal(isValidIdempotencyKey('has space in it'), false);
  });
  it('orders and deduplicates webhook events', () => {
    const tracker = new WebhookOrderTracker();
    const event = (id: string, version: number): WebhookEvent => ({ id, type: 'order.updated', api_version: '2026-10-21', created_at: '',
      data: { order_id: 'o1', store_id: 's', status: 'preparing', previous_status: null, current_status: 'ready', order_version: version,
        occurred_at: null, total: 1, currency: 'THB', updated_at: '', tracking_url: null } });
    assert.equal(tracker.shouldApply(event('e3', 3)), true);
    assert.equal(tracker.shouldApply(event('e3', 3)), false, 'duplicate Webhook-Id');
    assert.equal(tracker.shouldApply(event('e2', 2)), false, 'older version');
    assert.equal(tracker.shouldApply(event('e4', 4)), true);
  });
  it('verifies a platform webhook against published keys and answers the challenge', () => {
    const platform = keypair('ec');
    const keys = [{ ...platform.publicJwk, kid: platform.kid, use: 'sig', alg: 'ES256' }];
    const hook = 'https://agent.example/hooks/aicp';
    const body = JSON.stringify({ id: 'e1', type: 'order.updated' });
    const headers = new Headers({ 'content-type': 'application/json', 'webhook-id': 'e1' });
    const added = signMessage({ method: 'POST', url: hook, headers, body, privateJwk: platform.privateJwk, kid: platform.kid,
      components: [...WEBHOOK_SIGNATURE_COMPONENTS] });
    for (const [name, value] of Object.entries(added)) headers.set(name, value);
    assert.equal(verifyWebhookSignature({ url: hook, headers, body, keys }).ok, true);
    headers.set('webhook-id', 'e2');
    assert.equal(verifyWebhookSignature({ url: hook, headers, body, keys }).ok, false);
    assert.equal(verifyWebhookSignature({ url: hook, headers, body, keys: [] }).ok, false);
    assert.deepEqual(webhookVerificationResponse({ id: 'v', type: 'webhook.verification', api_version: '', created_at: '',
      data: { agent_id: null, challenge: 'abc' } }), { challenge: 'abc' });
  });
});
