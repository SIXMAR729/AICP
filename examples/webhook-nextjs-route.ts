// examples/webhook-nextjs-route.ts — app/api/aicp/webhook/route.ts in a Next.js agent backend.
import { createWebhookHandler } from '@aicp/core';

let keys: Array<Record<string, unknown>> = [];
async function platformKeys() {
  if (!keys.length) keys = (await fetch(`${process.env.AICP_BASE_URL}/.well-known/aicp.json`).then(r => r.json())).keys ?? [];
  return keys;
}

export const POST = createWebhookHandler({
  keys: platformKeys,
  publicUrl: process.env.AICP_WEBHOOK_PUBLIC_URL,   // the exact URL registered with the platform
  onEvent: async (event) => {
    // Keep it fast (< 5 s). Persist, then notify the user asynchronously.
    console.log(`[aicp] ${event.type} ${event.data.order_id} → ${event.data.status} (v${event.data.order_version})`);
  },
});
