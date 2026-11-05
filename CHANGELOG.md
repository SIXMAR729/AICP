# Changelog

## 1.1.0 — 2026-11-05
### Added
- `AICPClient`: discovery-driven agent client (capabilities, menu, contract, availability, register, me,
  settings incl. two-key rotation, createOrder, prepareDelivery, createPayment, cancelOrder, getOrder) with
  automatic RFC 9421 signing, Idempotency-Key handling and typed `AICPError` (`code`, `status`, `retryAfterSeconds`, `retryable`).
- `generateSigningKey()` / `signingKeyFromPrivateJwk()` (ES256, Ed25519; `kid` = RFC 7638).
- `createWebhookHandler()` Fetch-API receiver (verify, challenge, dedupe, ordering, retry-safe on handler failure).
- `WebhookOrderTracker.forget()` to undo `shouldApply()` when processing fails.
- More `AICP_ERROR_CODES` from the reference platform.
- Docs: agent quickstart, webhooks, error reference; examples; spec §0 base path, §10 error format.

## 1.0.0 — 2026-10-23
- Spec draft 1, wire types, contract validator, RFC 9421/9530 signature profile, webhook helpers.
