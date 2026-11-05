// examples/agent-order.ts — register (once), wait for approval, read the contract, order.
//   AICP_BASE_URL=https://pugmod.com AICP_STORE_ID=<uuid> npx tsx examples/agent-order.ts
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { AICPClient, AICPError, generateSigningKey, signingKeyFromPrivateJwk, newIdempotencyKey, validateAICPAnswers } from '@aicp/core';

const BASE = process.env.AICP_BASE_URL ?? 'https://pugmod.com';
const STORE = process.env.AICP_STORE_ID!;
const STATE = '.aicp-agent.json';   // demo only — use a secret manager in production

type State = { apiKey?: string; privateJwk?: JsonWebKey };
const state: State = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : {};
const key = state.privateJwk ? signingKeyFromPrivateJwk(state.privateJwk) : generateSigningKey();
const client = new AICPClient({ baseUrl: BASE, apiKey: state.apiKey, signingKey: key });

async function main() {
  await client.discover();
  if (!state.apiKey) {
    const reg = await client.register(STORE, { agent_name: 'Example Agent', scopes: ['order:create', 'order:read'], signing_jwk: key.publicJwk });
    writeFileSync(STATE, JSON.stringify({ apiKey: reg.api_key, privateJwk: key.privateJwk }), { mode: 0o600 });
    console.log('Registered. Ask the merchant to approve agent', reg.agent_id);
    return;
  }
  const me = await client.me(STORE);
  if (me.approval_status !== 'APPROVED') return console.log('Not approved yet:', me.approval_status);

  const schema = await client.getOrderSchema(STORE, 'order');
  const menu = await client.getMenu(STORE) as { items?: Array<{ id: string; name: string; price: number; is_available?: boolean }> };
  const item = menu.items?.find(i => i.is_available !== false);
  if (!item) return console.log('Nothing available');

  const answers = { customer_name: 'Example Buyer' };
  const check = validateAICPAnswers(schema, { store_id: STORE, idempotency_key: 'local-check', answers });
  if (!check.isValid) return console.log('Collect these first:', check.errors);

  const idem = newIdempotencyKey();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const order = await client.createOrder(STORE, { intent: 'order', items: [{ id: item.id, quantity: 1 }], answers }, idem);
      return console.log('Order', order.order_id, order.status, 'total', order.total, order.tracking_url);
    } catch (error) {
      if (!(error instanceof AICPError) || !error.retryable || attempt === 3) throw error;
      await new Promise(r => setTimeout(r, (error.retryAfterSeconds ?? attempt) * 1000));
    }
  }
}
main().catch(error => { console.error(error instanceof AICPError ? `${error.status} ${error.code}: ${error.message}` : error); process.exit(1); });
