// src/protocol.ts — AICP v1 wire types and helpers (spec/AICP-v1.md).
import { parsePublicSigningJwk, verifyRequestSignature, type PublicSigningJwk } from './signatures';

export const AICP_PROTOCOL_VERSION = '1.0';
export const AICP_WEBHOOK_API_VERSION = '2026-10-21';

export type AgentApprovalStatus = 'PENDING' | 'APPROVED' | 'EXPIRED' | 'REVOKED';
export type OrderStatus = 'pending_confirmation' | 'preparing' | 'ready' | 'completed' | 'cancelled';
export type CurrencyCode = 'THB' | (string & {});
export type PaymentProvider = 'promptpay' | 'cash_on_delivery' | (string & {});

export interface AgentProfile {
  agent_id: string;
  agent_name: string;
  store_id: string;
  scopes: string[];
  is_active: boolean;
  approval_status: AgentApprovalStatus;
  key_expires_at: string | null;
  can_transact: boolean;
  signing: { bound: true; kid: string } | { bound: false };
  webhook_url: string | null;
  message: string;
}

export interface OrderItemInput { id: string; quantity: number }

export interface CreateOrderRequest {
  intent?: string;
  items?: OrderItemInput[];
  slot_id?: string;
  quantity?: number;
  answers?: Record<string, unknown>;
  notes?: string;
}

export interface PrepareDeliveryRequest {
  items: OrderItemInput[];
  delivery_address: string;
  answers?: Record<string, unknown>;
  notes?: string;
}

export interface AICPMessage {
  type: 'error' | 'warning' | 'info';
  code: string;
  severity?: 'recoverable' | 'requires_buyer_input' | 'requires_buyer_review';
  content: string;
}

export interface PrepareDeliveryResponse {
  confirmation_id: string;
  status: 'requires_escalation';
  /** Absolute HTTPS URL for the buyer; null only when the platform has no canonical origin configured. */
  continue_url: string | null;
  /** Same link (legacy name); may be a relative path when continue_url is null. */
  approval_url: string;
  subtotal: number;
  delivery_fee: number;
  total: number;
  currency: CurrencyCode;
  expires_at: number;
  message: string;
  messages: AICPMessage[];
}

export interface WebhookEvent {
  id: string;
  type: 'order.created' | 'order.updated';
  api_version: string;
  created_at: string;
  data: {
    order_id: string;
    store_id: string;
    /** Status at the event. */
    status: OrderStatus | string;
    previous_status: string | null;
    /** Live status when the webhook was sent. */
    current_status: OrderStatus | string;
    order_version: number | null;
    occurred_at: string | null;
    total: number;
    currency: CurrencyCode;
    updated_at: string;
    tracking_url: string | null;
  };
}

export interface WebhookVerificationRequest {
  id: string;
  type: 'webhook.verification';
  api_version: string;
  created_at: string;
  data: { agent_id: string | null; challenge: string };
}

/** Error codes an agent should handle (non-exhaustive). */
export const AICP_ERROR_CODES = [
  'agent_pending_approval', 'agent_key_expired', 'agent_key_revoked', 'invalid_idempotency_key',
  'signature_missing', 'signature_required', 'signature_invalid', 'signature_expired', 'key_not_found',
  'components_missing', 'digest_mismatch', 'signing_key_proof_required', 'signing_key_removal_forbidden',
  'settings_signature_replayed', 'webhook_url_invalid', 'webhook_url_not_public', 'webhook_verification_failed',
  'buyer_owned_transaction', 'RATE_LIMIT_EXCEEDED',
  // Transactions (reference implementation)
  'invalid_request', 'COMMERCE_MUTATIONS_DISABLED', 'agent_pending_quota_exceeded',
  'DELIVERY_BUYER_CONFIRMATION_REQUIRED', 'availability_slot_not_found', 'slot_offering_not_available',
  'invalid_authoritative_price', 'idempotency_payload_mismatch', 'store_currently_closed',
  'CASH_DELIVERY_NOT_ENABLED', 'DELIVERY_OUT_OF_RANGE', 'DELIVERY_ADDRESS_REQUIRED', 'SCHEMA_VALIDATION_FAILED',
] as const;
export type AICPErrorCode = typeof AICP_ERROR_CODES[number];

/** §5.1: 8–128 characters of A-Z a-z 0-9 . _ : - */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_KEY_PATTERN.test(value);
}

/** §7 webhook signature components (add "@query" when the URL has a query). */
export const WEBHOOK_SIGNATURE_COMPONENTS = ['@method', '@authority', '@path', 'content-digest', 'content-type', 'webhook-id'] as const;

/** §7: answer body for a webhook.verification request. */
export function webhookVerificationResponse(event: WebhookVerificationRequest): { challenge: string } {
  return { challenge: event.data.challenge };
}

/**
 * §7 ordering: tracks the highest order_version applied per order and tells
 * whether an event should be applied. Events without a version are applied.
 */
export class WebhookOrderTracker {
  private readonly versions = new Map<string, number>();
  private readonly seen = new Set<string>();
  private readonly previous = new Map<string, number | undefined>();
  shouldApply(event: WebhookEvent): boolean {
    if (this.seen.has(event.id)) return false;
    this.seen.add(event.id);
    const version = event.data.order_version;
    if (typeof version !== 'number') return true;
    const applied = this.versions.get(event.data.order_id);
    if (applied !== undefined && version < applied) return false;
    this.previous.set(event.id, applied);
    this.versions.set(event.data.order_id, version);
    return true;
  }
  /** Undo shouldApply() for an event whose processing failed, so the platform's retry is applied. */
  forget(event: WebhookEvent): void {
    this.seen.delete(event.id);
    if (!this.previous.has(event.id)) return;
    const before = this.previous.get(event.id);
    this.previous.delete(event.id);
    if (this.versions.get(event.data.order_id) !== event.data.order_version) return;
    if (before === undefined) this.versions.delete(event.data.order_id);
    else this.versions.set(event.data.order_id, before);
  }
}

/**
 * Verifies a received webhook against the platform's published keys[] (§7).
 * Pass the exact URL the request was received on and the raw body.
 */
export function verifyWebhookSignature(options: {
  url: string; headers: Headers; body: string; keys: Array<Record<string, unknown>>; nowSeconds?: number;
}): { ok: true } | { ok: false; code: string } {
  const input = options.headers.get('signature-input') ?? '';
  const keyid = input.match(/keyid="([A-Za-z0-9_-]{43})"/)?.[1];
  const published = options.keys.find(key => key.kid === keyid);
  const parsed = published ? parsePublicSigningJwk(published) : null;
  if (!keyid || !parsed || parsed.kid !== keyid) return { ok: false, code: 'key_not_found' };
  const result = verifyRequestSignature({ method: 'POST', url: options.url, headers: options.headers, body: options.body,
    jwk: parsed.jwk as PublicSigningJwk, kid: parsed.kid, nowSeconds: options.nowSeconds });
  if (!result.ok) return result;
  const required = new URL(options.url).search ? [...WEBHOOK_SIGNATURE_COMPONENTS, '@query'] : WEBHOOK_SIGNATURE_COMPONENTS;
  const covered = input.match(/\(([^)]*)\)/)?.[1] ?? '';
  return required.every(name => covered.includes(`"${name}"`)) ? { ok: true } : { ok: false, code: 'components_missing' };
}
