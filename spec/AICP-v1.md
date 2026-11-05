# AICP v1 — AI Commerce Protocol

Status: Draft 1.1 (2026-11-05) · Reference implementation: Pugmod (pugmod.com) · SDK: `@aicp/core` ≥ 1.1

AICP lets an AI agent discover a store, obtain store-approved credentials,
place orders (pickup, booking, and buyer-confirmed delivery), pay, and track
orders. It is designed so that **every money-, stock- and identity-relevant
rule is enforced by the store platform**, never trusted from the agent.

AICP was inspired by the Universal Commerce Protocol (UCP) and the Agentic
Commerce Protocol (ACP) and reuses IETF standards (RFC 9421 HTTP Message
Signatures, RFC 9530 Content-Digest, RFC 7638 JWK Thumbprint). It is not
wire-compatible with UCP or ACP.

The key words MUST, MUST NOT, SHOULD and MAY are to be interpreted as in RFC 2119.

## 0. Conventions

- **Base path.** Paths in this document are relative to the platform's API base.
  Agents MUST take endpoint URLs from the platform document (§2.1 `endpoints`), where
  templates may use RFC 6570 (`{storeId}`, `{?intent}`). The reference implementation
  uses `https://<origin>/api/v1/commerce` (e.g. `/api/v1/commerce/store/{storeId}/orders`).
- **Encoding.** JSON bodies are UTF-8 `application/json`, at most 64 KiB. Money is a
  decimal number in the currency given (`THB` for the reference implementation).
- **Transport.** HTTPS only. Platforms MUST NOT follow redirects for agent calls; agents
  SHOULD NOT follow redirects either.

---

## 1. Roles

| Role | Description |
|---|---|
| Agent | An external AI system acting for a buyer. |
| Store | A merchant on an AICP platform. Approves or revokes agents. |
| Buyer | The person ordering. Authenticated by the platform, never by the agent. |
| Platform | The AICP server. Authoritative for prices, stock, totals and order state. |

## 2. Discovery

### 2.1 Platform document
`GET /.well-known/aicp.json` (alias: `/.well-known/<platform>.json`) returns a
JSON document with at least:

```json
{
  "protocol": "AICP",
  "version": "1.0",
  "capabilities": { "ordering": true, "booking": true, "delivery_quotes": true,
                    "payment_intents": true, "webhooks": true, "request_signatures": true },
  "endpoints": { "store_capabilities": "https://…/store/{storeId}/capabilities", "…": "…" },
  "message_signatures": { "standard": "RFC 9421 + RFC 9530", "algorithms": ["ES256", "Ed25519"], "…": "…" },
  "webhooks": { "events": ["order.created", "order.updated"], "api_version": "2026-10-21", "…": "…" },
  "keys": [ { "kty": "EC", "crv": "P-256", "x": "…", "y": "…", "kid": "<RFC 7638>", "use": "sig", "alg": "ES256" } ]
}
```

Platform capabilities describe protocol primitives only. Agents MUST read the
store capabilities before assuming a feature is enabled for a store.

### 2.2 Store resources (no authentication)
| Resource | Purpose |
|---|---|
| `GET /store/{storeId}/capabilities` | Which flows the store enables (menu, booking, delivery, payment, tracking, cancel). |
| `GET /store/{storeId}/menu` | Catalog with stable item IDs, prices, availability. |
| `GET /store/{storeId}/order-schema?intent=…` | The store's active contract: required answers and field rules. |
| `GET /store/{storeId}/availability` | Bookable slots (booking stores only). |

A human-readable store page MAY link the platform document via
`<link rel="alternate" type="application/json" href="/.well-known/aicp.json">`.

## 3. Agent identity

### 3.1 Registration
`POST /store/{storeId}/agents/register` with
`{ "agent_name": "…", "scopes": ["order:create","order:read"], "signing_jwk"?: {…}, "webhook_url"?: "https://…" }`.

- The response contains `api_key` exactly once. Agents MUST persist it and
  MUST NOT register again (also not after `403`), but poll §3.2 instead.
- The key starts in `PENDING` and is unusable until the store approves it.
- The display name shown to buyers is the **store-approved** name; the
  self-reported `agent_name` is never shown as trusted identity.
- Platforms SHOULD bound pending registrations per store and active agents per store.

### 3.2 Status
`GET /store/{storeId}/agents/me` (Bearer key) returns
`approval_status ∈ {PENDING, APPROVED, EXPIRED, REVOKED}`, `can_transact`,
`key_expires_at`, `signing`, `webhook_url`.

- `EXPIRED`: the key passed its expiry; the store renews it and the same key works again.
- `REVOKED`: rejected or revoked by the store; the agent MUST stop using the key.

Platforms MAY expire keys daily (the reference implementation: end of the
store's local day) and notify the store when an agent registers or changes
its signing key or webhook.

### 3.3 Settings
`POST /store/{storeId}/agents/me/settings` with `signing_jwk` and/or `webhook_url`.
Revoked keys MUST be refused. See §4 and §7 for the rules.

## 4. Request authentication

Every agent request carries `Authorization: Bearer <api_key>`.

### 4.1 Signatures (RFC 9421)
- Keys: public JWK, EC P-256 (ES256, raw r‖s) or OKP Ed25519. `keyid` = RFC 7638 thumbprint.
- Binding a key MUST be proven: the binding request is also signed by that key.
  Rotation requires signatures by the current **and** the new key (two labels).
- Once bound, every request with that API key MUST be signed, and the key
  cannot be removed (only rotated).
- Covered components: `"@method" "@authority" "@path"`, plus `"@query"` when a
  query exists, `"content-digest"` and `"content-type"` when a body exists, and
  `"idempotency-key"` when that header is sent.
- Parameters: `created` (required, within ±300 s), `keyid` (required),
  `expires` (optional, ≤ 3600 s after `created`).
- `Content-Digest` is an RFC 9530 dictionary; a `sha-256` member is REQUIRED,
  `sha-512` is verified when present, other algorithms are ignored.
- Signed settings changes are replay-ordered: a change is accepted only if its
  `created` is newer than the last accepted change.
- A platform MAY require signatures for all agents.

Error codes: `signature_missing`, `signature_required`, `signature_invalid`,
`signature_expired`, `key_not_found`, `components_missing`, `digest_mismatch`,
`signing_key_proof_required`, `signing_key_removal_forbidden`, `settings_signature_replayed`.

## 5. Transactions

### 5.1 Idempotency
Every transaction-creating `POST` (`/orders`, `/orders/{id}/payment`) MUST
carry `Idempotency-Key`: 8–128 characters of `A-Z a-z 0-9 . _ : -`
(a UUID v4 is RECOMMENDED). A retry with the same key and payload returns the
original result without side effects; the same key with a different payload
returns `409`.

### 5.2 Authority
The platform recomputes prices, totals, stock, delivery fees and contract
validation inside one atomic transaction. Values sent by the agent are inputs,
never authority. Items MUST be referenced by catalog ID.

### 5.3 Pickup / catalog order
`POST /store/{storeId}/orders` with `{ "intent": "order", "items": [{ "id", "quantity" }], "answers"?, "notes"? }`
→ `{ "order_id", "status": "pending_confirmation", "total", "tracking_url", … }`.

### 5.4 Booking
Same endpoint with `intent` from the store contract, a `slot_id` from
availability, `quantity`, and `answers` satisfying the contract.

### 5.5 Delivery (buyer escalation)
An agent MUST NOT create delivery orders directly.

1. `POST /store/{storeId}/orders/prepare` with `items` and `delivery_address`.
   The platform quotes the fee and returns
   `{ "status": "requires_escalation", "continue_url": "https://…", "subtotal", "delivery_fee", "total", "expires_at", "messages": [ { "type": "error", "code": "buyer_confirmation_required", "severity": "requires_buyer_review" } ] }`.
   No order exists yet. `continue_url` MUST be an absolute HTTPS URL on the
   platform's canonical origin and SHOULD expire within one hour.
2. The agent gives `continue_url` to the buyer. The buyer authenticates with
   the platform, reviews items, totals and the store-approved agent name, and confirms.
3. The order is created once, bound to the authenticated buyer. From then on
   the agent cannot cancel it; the buyer can.

Cash on delivery platforms SHOULD require a verified buyer phone, per-store
cash limits, a cap on open cash orders per buyer, and explicit consent for
contact data with a bounded retention period.

### 5.6 Payment
`POST /store/{storeId}/orders/{orderId}/payment` with `{ "provider": "promptpay" | "cash_on_delivery" }`
and `Idempotency-Key`. Creating an intent never marks an order paid; only a
trusted provider callback may.

### 5.7 Cancellation
`POST /store/{storeId}/orders/{orderId}/cancel` for orders the agent created
that no buyer owns. Cancellation releases stock/slots exactly once.

### 5.8 Order states
`pending_confirmation → preparing → ready → completed`, or `cancelled`.

## 6. Tracking
- `GET /store/{storeId}/orders/{orderId}` (scope `order:read`, rate limited), or
- the expiring signed `tracking_url`, or
- webhooks (§7, preferred).

## 7. Webhooks

- Registration: `webhook_url` (public HTTPS, port 443, no credentials, no fragment).
  Before saving, the platform POSTs a signed
  `{ "type": "webhook.verification", "data": { "challenge": "…" } }`; the
  endpoint MUST answer 2xx echoing the challenge (plain text or `{"challenge":"…"}`).
- Events: `order.created`, `order.updated`, only for orders the key created.
- Body:
  ```json
  { "id": "<event id>", "type": "order.updated", "api_version": "2026-10-21", "created_at": "…",
    "data": { "order_id": "…", "store_id": "…", "status": "preparing", "previous_status": "pending_confirmation",
              "current_status": "ready", "order_version": 3, "occurred_at": "…",
              "total": 120.5, "currency": "THB", "updated_at": "…", "tracking_url": "…" } }
  ```
  `data.status` is the status at the event; `data.current_status` is the live
  status at send time. Payloads MUST NOT contain buyer name, phone or address.
- Signature: RFC 9421 ES256 over `"@method" "@authority" "@path" "content-digest" "content-type" "webhook-id"`
  (`"@query"` when present), verified against `keys[]` by `keyid`.
- Delivery is at least once and possibly out of order. Receivers MUST
  deduplicate on `Webhook-Id` and SHOULD ignore events whose `order_version`
  is lower than one already applied. Receivers respond 2xx within 5 s; redirects are not followed.
- Platforms MUST protect webhook delivery against SSRF (public addresses only,
  checked at connect time).

## 8. Rate limits
Platforms SHOULD rate limit per agent and per client IP and return `429` with
`Retry-After`. Agents SHOULD prefer webhooks to polling.

## 9. Conformance
An implementation may call itself "AICP v1 compatible" when it passes the
conformance tests published with `@aicp/core`.

## 10. Errors
Every non-2xx response is a JSON object with a machine-readable `error` code and MAY
include a human-readable `message` and structured `details`:

```json
{ "error": "SCHEMA_VALIDATION_FAILED", "message": "…", "details": [ { "field": "phone", "message": "…" } ] }
```

Agents MUST branch on `error` (and fall back to the HTTP status for unknown codes),
never on `message`. Retries are safe only for network errors, `429`, `502`, `503` and
`504`, and only with the same `Idempotency-Key`. The SDK's `docs/errors.md` lists the
codes of the reference implementation.
