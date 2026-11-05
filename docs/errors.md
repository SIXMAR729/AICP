# Errors

Every non-2xx response is JSON with at least `{ "error": "<code>" }`. Some
responses also carry `message` and `details`.

`AICPClient` throws `AICPError`, which has these fields:

| Field | Meaning |
|---|---|
| `status` | HTTP status. `0` means a network failure |
| `code` | The platform's `error` code |
| `retryAfterSeconds` | From the `Retry-After` header, when present |
| `retryable` | `true` for `network_error`, `429`, `502`, `503`, `504` |

**Retry rule:** retry only when `retryable` is `true`, and always reuse the
**same** Idempotency-Key. All other errors need a change from you, the buyer
or the merchant first.

## Agent identity and keys

| Code | HTTP | What to do |
|---|---|---|
| `agent_pending_approval` | 403 | Wait for the merchant. Poll `me()`. Do **not** register again |
| `agent_key_expired` | 403 | The key expired (the reference platform expires keys daily). Wait for the merchant to renew. The same key will work again |
| `agent_key_revoked` | 403 | Stop using the key |
| `agent_pending_quota_exceeded` | 429 | Too many open transactions. Wait until some are confirmed or cancelled before creating more |
| `Registration closed by store owner.` | 403 | The store does not accept new agents |

## Signatures (§4.1)

| Code | What it means |
|---|---|
| `signature_missing` / `signature_required` | A key is bound (or the platform requires signatures) but the request was not signed |
| `signature_invalid` | Wrong key, a changed body, or an incorrect signature base |
| `signature_expired` | `created` is more than ±300 s off, or `expires` has passed. Check your clock (NTP) |
| `key_not_found` | `keyid` does not match the bound key |
| `components_missing` | A required covered component is missing (for example `idempotency-key` was sent but not signed) |
| `digest_mismatch` | `Content-Digest` does not match the body. Sign the exact bytes you send |
| `signing_key_proof_required` | Binding or rotating a key needs a signature by the new key too |
| `signing_key_removal_forbidden` | A bound key can be rotated but not removed |
| `settings_signature_replayed` | A settings change older than the last accepted one |

## Webhook settings (§7)

| Code | What it means |
|---|---|
| `webhook_url_invalid` | Not HTTPS on port 443, or has credentials or a fragment |
| `webhook_url_not_public` | The URL resolves to a private or reserved address |
| `webhook_verification_failed` | The endpoint did not answer the challenge with 2xx and the echo |

## Transactions (§5)

| Code | HTTP | What to do |
|---|---|---|
| `invalid_request` | 400 | Fix the payload shape (items ≤ 50, notes ≤ 1000, body ≤ 64 KiB) |
| `invalid_idempotency_key` | 400 | Use 8–128 chars of `A-Z a-z 0-9 . _ : -` |
| `idempotency_payload_mismatch` | 409 | Same key, different payload. This is a bug: generate a new key for a new operation |
| `SCHEMA_VALIDATION_FAILED` | 400 | Answers break the contract. `details` lists the fields. Ask the user again |
| `DELIVERY_BUYER_CONFIRMATION_REQUIRED` | 4xx | Delivery must use `prepareDelivery()` → `continue_url` |
| `CASH_DELIVERY_NOT_ENABLED` | 409 | The store does not offer cash delivery |
| `DELIVERY_ADDRESS_REQUIRED` / `DELIVERY_OUT_OF_RANGE` | 400 | Ask for a valid or closer address |
| `store_currently_closed` | 4xx | The store is closed or outside its opening hours. Try later |
| `availability_slot_not_found` / `slot_offering_not_available` | 404 / 409 | Re-read availability and choose another slot |
| `invalid_authoritative_price` | 422 | The store's price data is invalid. Report it to the merchant |
| `buyer_owned_transaction` | 4xx | The buyer owns this order. The agent cannot cancel it |
| `COMMERCE_MUTATIONS_DISABLED` | 403 | The platform paused ordering (emergency stop). Retry later; do not spam |
| `RATE_LIMIT_EXCEEDED` | 429 | Back off for `Retry-After` seconds |

The `AICP_ERROR_CODES` export lists these codes. The list is not exhaustive:
platforms may add codes, so always fall back on the HTTP status.
