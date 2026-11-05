# Webhooks

AICP platforms push `order.created` and `order.updated` events for the orders
your API key created (spec §7). Webhooks are preferred over polling.

## Register the endpoint

You can set `webhook_url` in two places: in `register()`, or later with
`client.updateSettings(storeId, { webhook_url })`.

Requirements for the URL:
- public HTTPS on port 443
- no credentials and no fragment in the URL
- no redirects (they are not followed)

Before saving the URL, the platform sends a signed `webhook.verification`
POST to it. Your endpoint MUST answer 2xx and echo `data.challenge`, as plain
text or as `{"challenge":"…"}`. `createWebhookHandler` does this for you.

## Handler

```ts
import { createWebhookHandler } from '@aicp/core';

let cachedKeys: Array<Record<string, unknown>> = [];
async function platformKeys() {
  if (!cachedKeys.length) cachedKeys = (await fetch('https://pugmod.com/.well-known/aicp.json').then(r => r.json())).keys;
  return cachedKeys;
}

export const POST = createWebhookHandler({
  keys: platformKeys,
  publicUrl: 'https://agent.example/hooks/aicp',   // set when behind a proxy that rewrites the URL
  onEvent: async (event) => {
    await queue.push(event);                       // keep it fast: respond within 5 s
  },
});
```

| Response | When |
|---|---|
| `200 {"challenge"}` | Verification request |
| `204` | Applied, a duplicate, an older version, or an unknown event type |
| `401 {"error": code}` | Signature invalid, unknown `keyid`, or missing components. Refresh `keys` and retry |
| `500` | `onEvent` threw. The event is "forgotten" so the platform's retry gets applied |

## Delivery semantics

- **At least once, possibly out of order.** Dedupe on `Webhook-Id` / `event.id`.
  Ignore events whose `data.order_version` is lower than one you already applied.
- `data.status` is the status **at the event**. `data.current_status` is the
  live status when the webhook was sent.
- Payloads never contain buyer name, phone or address.

The default `WebhookOrderTracker` keeps its state in memory. If you run more
than one process, or need state to survive restarts, pass your own `tracker`
backed by a database. It needs:

```ts
{ shouldApply(event): boolean; forget?(event): void }
```

## Signature

Webhooks are signed with RFC 9421, ES256, over
`"@method" "@authority" "@path" "content-digest" "content-type" "webhook-id"`.
`"@query"` is also covered when the URL has a query. Verify against the
platform's `keys[]` by `keyid`.

If you don't use the handler, the lower-level `verifyWebhookSignature()` is
available.
