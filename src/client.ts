// src/client.ts — AICP v1 agent client (spec/AICP-v1.md §2–§6).
/**
 * A small, dependency-free client for AI agents talking to an AICP platform.
 *
 *  - Discovery: reads /.well-known/aicp.json and uses its endpoint templates.
 *  - Auth: `Authorization: Bearer <api_key>` on every agent call (§4).
 *  - Signatures: when `signingKey` is set, every request is signed per the
 *    RFC 9421 profile (§4.1), including Content-Digest and Idempotency-Key.
 *  - Idempotency: transaction POSTs always carry an Idempotency-Key (§5.1);
 *    pass your own to retry safely, otherwise a UUID v4 is generated.
 *  - Errors: non-2xx responses throw AICPError with the platform's `error`
 *    code, HTTP status and Retry-After (seconds) when present.
 *
 * The platform is authoritative for prices, totals and state (§5.2): treat
 * every value you send as an input and every value you receive as the truth.
 */
import crypto from 'node:crypto';
import { requiredRequestComponents, signMessage } from './signatures';
import { isValidIdempotencyKey } from './protocol';
import type {
  AgentProfile, CreateOrderRequest, PaymentProvider, PrepareDeliveryRequest, PrepareDeliveryResponse,
} from './protocol';
import type { AICPOrderSchema } from './types';
import type { SigningKeyPair } from './keys';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AICPClientOptions {
  /** Platform origin, e.g. "https://pugmod.com". */
  baseUrl: string;
  /** API key from register(); required for every agent call except discovery and public store reads. */
  apiKey?: string;
  /** Bound signing key. Once a key is bound on the platform, every request MUST be signed (§4.1). */
  signingKey?: SigningKeyPair;
  /** Custom fetch (tests, proxies, edge runtimes). Defaults to globalThis.fetch. */
  fetch?: FetchLike;
  /** Extra headers on every request (e.g. User-Agent). */
  headers?: Record<string, string>;
  /** Request timeout in ms (default 15000). */
  timeoutMs?: number;
}

export interface PlatformDocument {
  protocol: 'AICP' | string;
  version: string;
  capabilities?: Record<string, boolean>;
  endpoints?: Record<string, string>;
  message_signatures?: Record<string, unknown>;
  webhooks?: { events?: string[]; api_version?: string; [key: string]: unknown };
  keys?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface RegisterAgentRequest {
  agent_name: string;
  scopes?: string[];
  /** Public JWK to bind at registration (the request is then signed with it as proof). */
  signing_jwk?: Record<string, unknown>;
  webhook_url?: string;
}

export interface RegisterAgentResponse {
  agent_id: string;
  agent_name: string;
  store_name?: string;
  /** Shown exactly once. Persist it; never register again (§3.1). */
  api_key: string;
  approval_status: 'PENDING';
  scopes: string[];
  signing: { bound: true; kid: string } | { bound: false };
  webhook_url: string | null;
  integration_warning?: string;
  [key: string]: unknown;
}

export interface OrderResponse {
  order_id: string;
  status: string;
  total: number;
  currency?: string;
  tracking_url?: string | null;
  idempotent_replay?: boolean;
  [key: string]: unknown;
}

export class AICPError extends Error {
  readonly status: number;
  /** Platform error code (e.g. "agent_pending_approval"), or "network_error" / "invalid_response". */
  readonly code: string;
  readonly retryAfterSeconds: number | null;
  readonly body: unknown;
  constructor(status: number, code: string, message: string, body: unknown, retryAfterSeconds: number | null) {
    super(message);
    this.name = 'AICPError';
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
  }
  /** True for failures worth retrying with the SAME Idempotency-Key. */
  get retryable(): boolean {
    return this.code === 'network_error' || this.status === 429 || this.status === 502 || this.status === 503 || this.status === 504;
  }
}

type Method = 'GET' | 'POST';
interface RequestOptions {
  body?: unknown;
  idempotencyKey?: string;
  auth?: boolean;
  /** Extra signing keys (key rotation: current + new key, §4.1). */
  extraSigners?: SigningKeyPair[];
  query?: Record<string, string | undefined>;
}

const DEFAULT_PATHS: Record<string, string> = {
  store_capabilities: '/api/v1/commerce/store/{storeId}/capabilities',
  store_menu: '/api/v1/commerce/store/{storeId}/menu',
  store_order_schema: '/api/v1/commerce/store/{storeId}/order-schema',
  store_availability: '/api/v1/commerce/store/{storeId}/availability',
  agent_register: '/api/v1/commerce/store/{storeId}/agents/register',
  agent_me: '/api/v1/commerce/store/{storeId}/agents/me',
  agent_settings: '/api/v1/commerce/store/{storeId}/agents/me/settings',
  orders: '/api/v1/commerce/store/{storeId}/orders',
  orders_prepare: '/api/v1/commerce/store/{storeId}/orders/prepare',
  order: '/api/v1/commerce/store/{storeId}/orders/{orderId}',
  order_payment: '/api/v1/commerce/store/{storeId}/orders/{orderId}/payment',
  order_cancel: '/api/v1/commerce/store/{storeId}/orders/{orderId}/cancel',
};

/** Client endpoint name → name in the platform document's `endpoints` (reference implementation). */
const PLATFORM_ENDPOINT_NAMES: Record<string, string> = {
  store_menu: 'store_catalog',
  store_order_schema: 'store_contract',
  agent_me: 'agent_identity',
  orders: 'store_transaction',
  orders_prepare: 'external_delivery_prepare',
  order_payment: 'payment_intent',
  order_cancel: 'store_cancel',
};

export class AICPClient {
  private readonly baseUrl: string;
  private apiKey?: string;
  private signingKey?: SigningKeyPair;
  private readonly fetchImpl: FetchLike;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private platform?: PlatformDocument;

  constructor(options: AICPClientOptions) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
      throw new Error('AICP baseUrl must use https (http is allowed only for localhost).');
    }
    this.baseUrl = url.origin;
    this.apiKey = options.apiKey;
    this.signingKey = options.signingKey;
    const fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) throw new Error('No fetch implementation available (Node 18+ or pass options.fetch).');
    this.fetchImpl = fetchImpl;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 15000;
  }

  /** Use a key after register() or after loading it from your secret store. */
  setApiKey(apiKey: string) { this.apiKey = apiKey; }
  setSigningKey(key: SigningKeyPair | undefined) { this.signingKey = key; }

  // ── §2 Discovery ──────────────────────────────────────────────────────────
  async discover(): Promise<PlatformDocument> {
    const doc = await this.request<PlatformDocument>('GET', '/.well-known/aicp.json', { auth: false });
    if (!doc || doc.protocol !== 'AICP') throw new AICPError(200, 'invalid_response', 'Not an AICP platform document.', doc, null);
    this.platform = doc;
    return doc;
  }
  async getCapabilities(storeId: string) { return this.request<Record<string, unknown>>('GET', this.path('store_capabilities', { storeId }), { auth: false }); }
  async getMenu(storeId: string) { return this.request<Record<string, unknown>>('GET', this.path('store_menu', { storeId }), { auth: false }); }
  async getOrderSchema(storeId: string, intent = 'order') {
    return this.request<AICPOrderSchema & Record<string, unknown>>('GET', this.path('store_order_schema', { storeId }), { auth: false, query: { intent } });
  }
  async getAvailability(storeId: string, query?: Record<string, string | undefined>) {
    return this.request<Record<string, unknown>>('GET', this.path('store_availability', { storeId }), { auth: false, query });
  }

  // ── §3 Agent identity ─────────────────────────────────────────────────────
  /**
   * Registers this agent with a store. Call ONCE per store and persist api_key;
   * on 403 or PENDING, poll me() instead of registering again (§3.1).
   * If signing_jwk is given, the request is signed with options.signingKey as proof.
   */
  async register(storeId: string, body: RegisterAgentRequest): Promise<RegisterAgentResponse> {
    const result = await this.request<RegisterAgentResponse>('POST', this.path('agent_register', { storeId }), { auth: false, body });
    if (typeof result.api_key === 'string') this.apiKey = result.api_key;
    return result;
  }
  async me(storeId: string) { return this.request<AgentProfile>('GET', this.path('agent_me', { storeId })); }

  /**
   * Binds/rotates the signing key and/or sets the webhook URL (§3.3, §4.1).
   * Rotation: pass `newSigningKey`; the request is signed by the current key
   * (if any) AND the new key. On success the client switches to the new key.
   */
  async updateSettings(storeId: string, settings: { newSigningKey?: SigningKeyPair; webhook_url?: string | null }) {
    const body: Record<string, unknown> = {};
    if (settings.newSigningKey) body.signing_jwk = settings.newSigningKey.publicJwk;
    if (settings.webhook_url !== undefined) body.webhook_url = settings.webhook_url;
    const result = await this.request<Record<string, unknown>>('POST', this.path('agent_settings', { storeId }), {
      body, extraSigners: settings.newSigningKey ? [settings.newSigningKey] : undefined,
    });
    if (settings.newSigningKey) this.signingKey = settings.newSigningKey;
    return result;
  }

  // ── §5 Transactions ───────────────────────────────────────────────────────
  /** Pickup / catalog order or booking (§5.3, §5.4). Delivery uses prepareDelivery(). */
  async createOrder(storeId: string, order: CreateOrderRequest, idempotencyKey?: string) {
    return this.request<OrderResponse>('POST', this.path('orders', { storeId }), { body: order, idempotencyKey: idempotencyKey ?? newIdempotencyKey() });
  }
  /** Delivery: returns continue_url for the BUYER to confirm; no order exists yet (§5.5). */
  async prepareDelivery(storeId: string, request: PrepareDeliveryRequest) {
    return this.request<PrepareDeliveryResponse>('POST', this.path('orders_prepare', { storeId }), { body: request });
  }
  /** Creates a payment intent. Never marks the order paid (§5.6). */
  async createPayment(storeId: string, orderId: string, provider: PaymentProvider, idempotencyKey?: string) {
    return this.request<Record<string, unknown>>('POST', this.path('order_payment', { storeId, orderId }), {
      body: { provider }, idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
    });
  }
  /** Cancels an order this agent created and no buyer owns (§5.7). */
  async cancelOrder(storeId: string, orderId: string, reason?: string) {
    return this.request<Record<string, unknown>>('POST', this.path('order_cancel', { storeId, orderId }), { body: reason ? { reason } : {} });
  }
  /** §6 tracking (prefer webhooks). */
  async getOrder(storeId: string, orderId: string) {
    return this.request<Record<string, unknown>>('GET', this.path('order', { storeId, orderId }));
  }

  // ── internals ─────────────────────────────────────────────────────────────
  private path(name: string, params: Record<string, string>): string {
    const published = this.platform?.endpoints?.[PLATFORM_ENDPOINT_NAMES[name] ?? name];
    const template = published ?? DEFAULT_PATHS[name];
    if (!template) throw new Error(`Unknown AICP endpoint: ${name}`);
    // RFC 6570 query expansions ("{?intent}") are filled from options.query instead.
    let out = template.replace(/\{\?[^}]*\}/g, '');
    for (const [key, value] of Object.entries(params)) {
      if (!value || /[/?#\s]/.test(value)) throw new Error(`Invalid ${key}`);
      out = out.split(`{${key}}`).join(encodeURIComponent(value));
    }
    if (/\{[a-zA-Z]+\}/.test(out)) throw new Error(`Missing path parameter in ${template}`);
    return out;
  }

  private async request<T>(method: Method, pathOrUrl: string, options: RequestOptions = {}): Promise<T> {
    const url = new URL(pathOrUrl, this.baseUrl);
    if (url.origin !== this.baseUrl) throw new Error('Endpoint must stay on the platform origin.');
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== undefined) url.searchParams.set(key, value);

    const headers = new Headers({ accept: 'application/json', ...this.headers });
    const body = options.body === undefined ? '' : JSON.stringify(options.body);
    if (body) headers.set('content-type', 'application/json');
    if (options.auth !== false) {
      if (!this.apiKey) throw new Error('apiKey is required for this call (register() or setApiKey()).');
      headers.set('authorization', `Bearer ${this.apiKey}`);
    }
    if (options.idempotencyKey !== undefined) {
      if (!isValidIdempotencyKey(options.idempotencyKey)) throw new Error('Idempotency-Key must be 8–128 chars of A-Z a-z 0-9 . _ : -');
      headers.set('idempotency-key', options.idempotencyKey);
    }

    const signers = [this.signingKey, ...(options.extraSigners ?? [])].filter((k, i, all): k is SigningKeyPair =>
      Boolean(k) && all.findIndex(o => o?.kid === k!.kid) === i);
    if (signers.length) {
      const components = requiredRequestComponents({ method, url: url.toString(), headers }, body.length > 0);
      const inputs: string[] = [], sigs: string[] = [];
      signers.forEach((key, index) => {
        const added = signMessage({ method, url: url.toString(), headers, body, privateJwk: key.privateJwk, kid: key.kid,
          components, label: `sig${index + 1}` });
        if (added['content-digest']) headers.set('content-digest', added['content-digest']);
        inputs.push(added['signature-input']); sigs.push(added['signature']);
      });
      headers.set('signature-input', inputs.join(', '));
      headers.set('signature', sigs.join(', '));
    }

    let response: Response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      response = await this.fetchImpl(url.toString(), { method, headers, body: body || undefined, signal: controller.signal, redirect: 'error' });
    } catch (error) {
      throw new AICPError(0, 'network_error', error instanceof Error ? error.message : 'Network error', null, null);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let data: unknown = null;
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!response.ok) {
      const record = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      const code = typeof record.error === 'string' ? record.error : typeof record.code === 'string' ? record.code : `http_${response.status}`;
      const message = typeof record.message === 'string' ? record.message : code;
      const retry = Number(response.headers.get('retry-after'));
      throw new AICPError(response.status, code, message, data, Number.isFinite(retry) && retry >= 0 ? retry : null);
    }
    if (data === null || typeof data !== 'object') throw new AICPError(response.status, 'invalid_response', 'Expected a JSON object.', data, null);
    return data as T;
  }
}

/** UUID v4 Idempotency-Key (§5.1). Keep it and reuse it when retrying the same operation. */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
