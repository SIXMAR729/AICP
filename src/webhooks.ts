// src/webhooks.ts — receiver helper for AICP order webhooks (spec/AICP-v1.md §7).
import {
  verifyWebhookSignature, webhookVerificationResponse, WebhookOrderTracker,
  type WebhookEvent, type WebhookVerificationRequest,
} from './protocol';

export interface WebhookHandlerOptions {
  /** The platform's published keys[] (from discover()). Refresh when a key is not found. */
  keys: Array<Record<string, unknown>> | (() => Promise<Array<Record<string, unknown>>>);
  /** Called once per new, in-order event. Throw to answer 500 (the platform retries). */
  onEvent: (event: WebhookEvent) => void | Promise<void>;
  /**
   * Dedup + ordering state (§7). The default is in-memory; use your own store
   * (DB/Redis) when you run more than one process.
   */
  tracker?: Pick<WebhookOrderTracker, 'shouldApply'> & Partial<Pick<WebhookOrderTracker, 'forget'>>;
  /** Public URL the platform calls, when the request URL seen by your server differs (proxies). */
  publicUrl?: string;
}

/**
 * Fetch-API handler (Next.js route handlers, Hono, Bun, Deno, Cloudflare Workers).
 *
 *   export const POST = createWebhookHandler({ keys: () => loadKeys(), onEvent });
 *
 * Verifies the RFC 9421 signature against keys[], answers webhook.verification
 * challenges, drops duplicates/out-of-order events and responds within the
 * platform's 5 s budget — do slow work asynchronously from onEvent.
 */
export function createWebhookHandler(options: WebhookHandlerOptions) {
  const tracker = options.tracker ?? new WebhookOrderTracker();
  return async function handle(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('method_not_allowed', { status: 405 });
    const body = await request.text();
    if (body.length > 65536) return new Response('payload_too_large', { status: 413 });
    const keys = typeof options.keys === 'function' ? await options.keys() : options.keys;
    const url = options.publicUrl ?? request.url;
    const verified = verifyWebhookSignature({ url, headers: request.headers, body, keys });
    if (!verified.ok) return Response.json({ error: verified.code }, { status: 401 });

    let payload: WebhookEvent | WebhookVerificationRequest;
    try { payload = JSON.parse(body); } catch { return Response.json({ error: 'invalid_json' }, { status: 400 }); }

    if (payload.type === 'webhook.verification') return Response.json(webhookVerificationResponse(payload));
    if (payload.type !== 'order.created' && payload.type !== 'order.updated') return new Response(null, { status: 204 });
    if (!tracker.shouldApply(payload)) return new Response(null, { status: 204 });
    try {
      await options.onEvent(payload);
    } catch {
      tracker.forget?.(payload); // let the platform's retry be applied
      return Response.json({ error: 'handler_failed' }, { status: 500 });
    }
    return new Response(null, { status: 204 });
  };
}
