# AICP Core (AI Commerce Protocol)

`@aicp/core` is the open toolkit for **AICP v1**, a protocol for AI agents
(ChatGPT, Gemini, Claude, Copilot, your own). With it an agent can:

- discover a store
- get approved by the merchant
- place orders
- hand delivery confirmation to the buyer
- track orders with signed webhooks

The platform stays authoritative for every price, total, stock count and order
state. The agent sends inputs. The platform decides.

| You are building… | Use |
|---|---|
| An **AI agent** that orders from AICP stores | `AICPClient`, `generateSigningKey`, `createWebhookHandler` |
| An **AICP platform / store backend** | `validateAICPAnswers`, `verifyRequestSignature`, `signMessage`, wire types |
| A store **contract** (what an agent must collect) | `AICPOrderSchema` + `validateAICPAnswers` |

- Spec: [`spec/AICP-v1.md`](spec/AICP-v1.md) (normative)
- Guides: [`docs/agent-quickstart.md`](docs/agent-quickstart.md) · [`docs/webhooks.md`](docs/webhooks.md) · [`docs/errors.md`](docs/errors.md)
- Examples: [`examples/`](examples)
- Reference platform: Pugmod (`https://pugmod.com/.well-known/aicp.json`)

Requires Node.js 18+ (uses `fetch` and `node:crypto`). No runtime dependencies.

```bash
npm install @aicp/core
```

---

## 5-minute agent quickstart

```ts
import { AICPClient, AICPError, generateSigningKey } from '@aicp/core';

const STORE = '<store uuid>';
const key = generateSigningKey();                 // keep key.privateJwk in your secret store
const client = new AICPClient({ baseUrl: 'https://pugmod.com', signingKey: key });

await client.discover();                          // reads /.well-known/aicp.json

// 1. Register ONCE per store and persist the api_key (shown only once).
const reg = await client.register(STORE, {
  agent_name: 'Acme Assistant',
  scopes: ['order:create', 'order:read'],
  signing_jwk: key.publicJwk,                     // the request is signed with `key` as proof
  webhook_url: 'https://agent.example/hooks/aicp',
});
saveSecret('aicp_api_key', reg.api_key);

// 2. Wait for the merchant to approve (poll, don't re-register).
const me = await client.me(STORE);                // approval_status: PENDING → APPROVED

// 3. Read the store's contract and menu, collect answers from the user.
const schema = await client.getOrderSchema(STORE, 'order');
const menu = await client.getMenu(STORE);

// 4. Order (pickup). Keep the Idempotency-Key and reuse it on retry.
const idem = crypto.randomUUID();
try {
  const order = await client.createOrder(STORE, { intent: 'order', items: [{ id: '<menu item id>', quantity: 2 }] }, idem);
  console.log(order.order_id, order.status, order.total);   // total comes from the platform
} catch (e) {
  if (e instanceof AICPError && e.retryable) { /* retry later with the SAME idem */ }
  else throw e;
}
```

Delivery is buyer-confirmed. The agent never creates a delivery order itself:

```ts
const draft = await client.prepareDelivery(STORE, { items: [{ id: '<item>', quantity: 1 }], delivery_address: '…' });
// draft.status === 'requires_escalation' → send draft.continue_url to the BUYER.
// The buyer signs in, reviews items, fee and total, and confirms.
```

## Receive webhooks (Next.js / Hono / Workers / Bun)

```ts
import { createWebhookHandler } from '@aicp/core';

export const POST = createWebhookHandler({
  keys: async () => (await fetch('https://pugmod.com/.well-known/aicp.json').then(r => r.json())).keys,
  onEvent: async (event) => {
    await db.orders.update(event.data.order_id, { status: event.data.status, version: event.data.order_version });
  },
});
```

The handler does four things:
- verifies the RFC 9421 signature
- answers the `webhook.verification` challenge
- drops duplicates and out-of-order events
- returns 500 when `onEvent` throws, so the platform retries

See [`docs/webhooks.md`](docs/webhooks.md).

## Store contracts (platform side)

```ts
import { AICPOrderSchema, validateAICPAnswers } from '@aicp/core';

const bikeRental: AICPOrderSchema = {
  version: '1.0', intent: 'booking',
  ai_prompt: 'Ask for rental details one by one. Be polite and concise.',
  workflow: ['collect_info', 'confirm', 'payment'],
  required: ['customer_name', 'phone', 'days'],
  fields: {
    customer_name: { type: 'text', description: 'Name of the renter' },
    phone: { type: 'tel', description: '10-digit phone number', pattern: '^0[0-9]{9}$' },
    days: { type: 'number', description: 'Number of days to rent', min: 1, max: 30 },
  },
};

const result = validateAICPAnswers(bikeRental, { store_id: 's1', idempotency_key: 'req-abc-456', answers });
if (!result.isValid) return Response.json({ error: 'SCHEMA_VALIDATION_FAILED', details: result.errors }, { status: 400 });
```

## Signatures without the client

```ts
import { signMessage, requiredRequestComponents } from '@aicp/core';

const headers = new Headers({ 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() });
const message = { method: 'POST', url: `${apiBase}/orders`, headers };
Object.entries(signMessage({ ...message, body, privateJwk, kid, components: requiredRequestComponents(message, true) }))
  .forEach(([name, value]) => headers.set(name, value));
```

## API reference

| Export | What it does |
|---|---|
| `AICPClient` | `discover`, `getCapabilities`, `getMenu`, `getOrderSchema`, `getAvailability`, `register`, `me`, `updateSettings` (bind/rotate key, webhook), `createOrder`, `prepareDelivery`, `createPayment`, `cancelOrder`, `getOrder` |
| `AICPError` | `status`, `code`, `retryAfterSeconds`, `retryable`, `body` |
| `newIdempotencyKey()` | UUID v4 Idempotency-Key |
| `generateSigningKey(alg?)` / `signingKeyFromPrivateJwk(jwk)` | ES256 (default) or Ed25519 key pairs, `kid` = RFC 7638 thumbprint |
| `createWebhookHandler(opts)` | Fetch-API webhook receiver |
| `verifyWebhookSignature`, `WebhookOrderTracker`, `webhookVerificationResponse` | Low-level webhook pieces |
| `signMessage`, `verifyRequestSignature`, `requiredRequestComponents`, `contentDigest`, `contentDigestMatches`, `parsePublicSigningJwk`, `jwkThumbprint` | RFC 9421 / 9530 profile |
| `validateAICPAnswers`, `AICPOrderSchema`, `AICPFieldDefinition` | Contract validation |
| `AICP_ERROR_CODES`, `isValidIdempotencyKey`, wire types (`AgentProfile`, `CreateOrderRequest`, `PrepareDeliveryResponse`, `WebhookEvent`, …) | Protocol constants and types |

## Scope

This package holds the open parts of AICP: the spec, wire types, contract
validator, signature profile, agent client and webhook helpers.

A platform's enforcement layer is not included. That layer covers atomic order
and stock transactions, cash-on-delivery safety, rider dispatch, data retention
and fraud limits.

AICP is inspired by UCP and ACP and uses RFC 9421, RFC 9530 and RFC 7638. It is
not wire-compatible with UCP or ACP.

## Development

```bash
npm install
npm run typecheck && npm test && npm run build
```

See [CONTRIBUTING.md](CONTRIBUTING.md). Licensed under MIT.
