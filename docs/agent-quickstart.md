# Agent quickstart

This guide takes an agent from nothing to a tracked order on an AICP v1
platform. Section numbers (§) refer to [`spec/AICP-v1.md`](../spec/AICP-v1.md).

## 0. Before you start

- Node.js 18+ and `npm install @aicp/core`.
- The platform origin, for example `https://pugmod.com`.
- A store id. Platforms list stores through their own discovery APIs. On Pugmod
  these are `endpoints.discovery` and `endpoints.search_semantic` in
  `/.well-known/aicp.json`.
- A place to keep secrets: the API key and your private signing JWK.

## 1. Discover (§2)

```ts
const client = new AICPClient({ baseUrl: 'https://pugmod.com', signingKey });
const platform = await client.discover();
const caps = await client.getCapabilities(storeId);     // what THIS store enables
```

Platform capabilities only say what the protocol supports. Always check the
store's capabilities before you offer a flow. For example, if delivery is off,
don't offer delivery.

## 2. Keys and registration (§3, §4.1)

```ts
const signingKey = generateSigningKey();               // ES256; or generateSigningKey('Ed25519')
store.put('aicp_private_jwk', signingKey.privateJwk);  // later: signingKeyFromPrivateJwk(jwk)

const reg = await client.register(storeId, {
  agent_name: 'Acme Assistant',
  scopes: ['order:create', 'order:read'],
  signing_jwk: signingKey.publicJwk,
  webhook_url: 'https://agent.example/hooks/aicp',
});
store.put(`aicp_key:${storeId}`, reg.api_key);         // shown ONCE
```

Rules:
- Register **once per store**. A 403 or a PENDING key is not a reason to register
  again. Poll `client.me(storeId)` until `approval_status === 'APPROVED'`.
- Keys can be `EXPIRED`. The reference platform expires keys daily at the end
  of the store's local day. The merchant renews it and the same key works again.
- `REVOKED` is final. Stop using the key.
- Once a signing key is bound, **every** request must be signed. The client
  does this automatically when `signingKey` is set.
- To rotate the key, call
  `client.updateSettings(storeId, { newSigningKey: generateSigningKey() })`.
  The client signs the request with both the old and the new key, then
  switches to the new one.

## 3. Read the contract (§2.2)

```ts
const schema = await client.getOrderSchema(storeId, 'order');   // or a booking intent
const menu = await client.getMenu(storeId);
```

The contract defines `required` and `fields`, each with a type, pattern and
min/max. It also has an `ai_prompt` the store wrote for agents. Collect every
required answer from the user before ordering.

You can check the answers locally with `validateAICPAnswers(schema, { store_id, idempotency_key, answers })`
to avoid round trips. The platform validates them again.

## 4. Place the order (§5)

```ts
const idem = newIdempotencyKey();                       // persist with the pending operation
const order = await client.createOrder(storeId, {
  intent: 'order',
  items: [{ id: menuItemId, quantity: 2 }],             // catalog IDs only, never prices
  answers,
  notes: 'no chili',
}, idem);
```

- Show the user **the platform's** `total`, not one you computed.
- On a retryable error (`err.retryable`, i.e. network/429/5xx), retry with the
  **same** `idem`. The platform returns the original order (`idempotent_replay: true`).
- The same key with a different payload returns `409 idempotency_payload_mismatch`.
  That means a bug on your side. Do not retry it.

### Bookings (§5.4)
Use the booking `intent` from the contract and a `slot_id` from
`client.getAvailability(storeId, { from, to })`. Set `quantity` and the
contract `answers`.

### Delivery (§5.5)
```ts
const draft = await client.prepareDelivery(storeId, { items, delivery_address });
// → { status: 'requires_escalation', continue_url, subtotal, delivery_fee, total, expires_at }
```
Give `continue_url` to the buyer. The platform signs the buyer in and shows
the items, fee, total and the store-approved agent name. The buyer confirms
there. Until then no order exists.

Once the buyer confirms, the order belongs to the buyer. You can track it but
you cannot cancel it.

### Payment (§5.6)
`client.createPayment(storeId, orderId, 'promptpay' | 'cash_on_delivery')`
creates an intent. It never marks the order paid. Only the platform's trusted
payment provider can do that, through its own callback.

### Cancel (§5.7)
`client.cancelOrder(storeId, orderId)` works only for orders you created that
no buyer owns.

## 5. Track (§6, §7)

Prefer webhooks ([webhooks.md](webhooks.md)). If you must poll, use
`client.getOrder(storeId, orderId)`. Respect `429` / `Retry-After`.

Order states: `pending_confirmation → preparing → ready → completed`, or
`cancelled`. Prepaid orders do not advance until the payment is settled.

## 6. Going live checklist

- [ ] API key and private JWK are kept in a secret manager, not in source or logs.
- [ ] One registration per store, with approval polling.
- [ ] Every transaction POST has a persisted Idempotency-Key that is reused on retry.
- [ ] Totals shown to users come from platform responses.
- [ ] Delivery goes through `prepareDelivery` → `continue_url`.
- [ ] The webhook endpoint verifies signatures, dedupes, and answers within 5 s.
- [ ] `AICPError.code` is handled per [errors.md](errors.md), with no blind retries.
