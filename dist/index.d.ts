type AICPIntent = 'booking' | 'order' | 'inquiry' | (string & {});
type FieldType = 'text' | 'tel' | 'number' | 'date' | 'boolean' | 'email';
interface AICPFieldDefinition {
    type: FieldType;
    description: string;
    required?: boolean;
    pattern?: string;
    min?: number;
    max?: number;
}
interface AICPOrderSchema {
    version: string;
    intent: AICPIntent;
    ai_prompt: string;
    workflow: string[];
    required: string[];
    fields: Record<string, AICPFieldDefinition>;
}
interface AICPOrderPayload {
    store_id: string;
    idempotency_key: string;
    answers: Record<string, any>;
}

interface ValidationResult {
    isValid: boolean;
    errors: Array<{
        field: string;
        message: string;
    }>;
}
interface AICPJsonSchemaProperty {
    type: 'string' | 'number' | 'boolean';
    description: string;
    pattern?: string;
    format?: 'email' | 'date';
    minimum?: number;
    maximum?: number;
}
interface AICPJsonSchema {
    type: 'object';
    description?: string;
    properties: Record<string, AICPJsonSchemaProperty>;
    required: string[];
    additionalProperties: boolean;
}
/**
 * Converts an AICPOrderSchema into a standard JSON Schema object suitable for
 * MCP tool `inputSchema` or LLM function-calling parameters (OpenAI, Claude, Gemini).
 */
declare function toJsonSchema(schema: AICPOrderSchema): AICPJsonSchema;
declare function validateAICPAnswers(schema: AICPOrderSchema, payload: AICPOrderPayload): ValidationResult;

type PublicSigningJwk = {
    kty: 'EC';
    crv: 'P-256';
    x: string;
    y: string;
} | {
    kty: 'OKP';
    crv: 'Ed25519';
    x: string;
};
type SignatureFailure = 'signature_missing' | 'signature_invalid' | 'signature_expired' | 'digest_mismatch' | 'key_not_found' | 'components_missing';
/** Validates and canonicalises a public JWK. Private material is always rejected. */
declare function parsePublicSigningJwk(input: unknown): {
    jwk: PublicSigningJwk;
    kid: string;
} | null;
/** RFC 7638 thumbprint (required members, lexicographic order). */
declare function jwkThumbprint(jwk: PublicSigningJwk): string;
declare function contentDigest(body: string | Buffer): string;
/** Verifies an RFC 9530 Content-Digest dictionary against the body. */
declare function contentDigestMatches(header: string, body: string | Buffer): boolean;
interface ParsedSignature {
    components: string[];
    params: Record<string, string | number>;
    /** Exact serialized inner list from Signature-Input, used verbatim for "@signature-params". */
    signatureParams: string;
    signature: Buffer;
}
/**
 * Parses one labelled signature. With several labels, the one whose keyid equals
 * preferKeyId wins (so a request may carry signatures by two keys, e.g. during
 * key rotation); otherwise the first label present in both headers.
 */
declare function parseSignatureHeaders(signatureInput: string | null, signature: string | null, preferKeyId?: string): ParsedSignature | null;
interface MessageParts {
    method: string;
    url: string;
    headers: Headers;
    status?: number;
}
declare function signatureBase(components: string[], signatureParams: string, message: MessageParts): string | null;
/** Components a request must cover under this profile. */
declare function requiredRequestComponents(message: MessageParts, hasBody: boolean): string[];
declare function verifyRequestSignature(options: MessageParts & {
    body: string;
    jwk: PublicSigningJwk;
    kid: string;
    nowSeconds?: number;
}): {
    ok: true;
    created: number;
} | {
    ok: false;
    code: SignatureFailure;
};
/** Signs an outgoing message (used for webhooks and by test clients). Returns headers to add. */
declare function signMessage(options: MessageParts & {
    body: string;
    privateJwk: JsonWebKey;
    kid: string;
    components: string[];
    nowSeconds?: number;
    label?: string;
}): Record<string, string>;

declare const AICP_PROTOCOL_VERSION = "1.0";
declare const AICP_WEBHOOK_API_VERSION = "2026-10-21";
type AgentApprovalStatus = 'PENDING' | 'APPROVED' | 'EXPIRED' | 'REVOKED';
type OrderStatus = 'pending_confirmation' | 'preparing' | 'ready' | 'completed' | 'cancelled';
type CurrencyCode = 'THB' | (string & {});
type PaymentProvider = 'promptpay' | 'cash_on_delivery' | (string & {});
interface AgentProfile {
    agent_id: string;
    agent_name: string;
    store_id: string;
    scopes: string[];
    is_active: boolean;
    approval_status: AgentApprovalStatus;
    key_expires_at: string | null;
    can_transact: boolean;
    signing: {
        bound: true;
        kid: string;
    } | {
        bound: false;
    };
    webhook_url: string | null;
    message: string;
}
interface OrderItemInput {
    id: string;
    quantity: number;
}
interface CreateOrderRequest {
    intent?: string;
    items?: OrderItemInput[];
    slot_id?: string;
    quantity?: number;
    answers?: Record<string, unknown>;
    notes?: string;
}
interface PrepareDeliveryRequest {
    items: OrderItemInput[];
    delivery_address: string;
    answers?: Record<string, unknown>;
    notes?: string;
}
interface AICPMessage {
    type: 'error' | 'warning' | 'info';
    code: string;
    severity?: 'recoverable' | 'requires_buyer_input' | 'requires_buyer_review';
    content: string;
}
interface PrepareDeliveryResponse {
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
interface WebhookEvent {
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
interface WebhookVerificationRequest {
    id: string;
    type: 'webhook.verification';
    api_version: string;
    created_at: string;
    data: {
        agent_id: string | null;
        challenge: string;
    };
}
/** Error codes an agent should handle (non-exhaustive). */
declare const AICP_ERROR_CODES: readonly ["agent_pending_approval", "agent_key_expired", "agent_key_revoked", "invalid_idempotency_key", "signature_missing", "signature_required", "signature_invalid", "signature_expired", "key_not_found", "components_missing", "digest_mismatch", "signing_key_proof_required", "signing_key_removal_forbidden", "settings_signature_replayed", "webhook_url_invalid", "webhook_url_not_public", "webhook_verification_failed", "buyer_owned_transaction", "RATE_LIMIT_EXCEEDED", "invalid_request", "COMMERCE_MUTATIONS_DISABLED", "agent_pending_quota_exceeded", "DELIVERY_BUYER_CONFIRMATION_REQUIRED", "availability_slot_not_found", "slot_offering_not_available", "invalid_authoritative_price", "idempotency_payload_mismatch", "store_currently_closed", "CASH_DELIVERY_NOT_ENABLED", "DELIVERY_OUT_OF_RANGE", "DELIVERY_ADDRESS_REQUIRED", "SCHEMA_VALIDATION_FAILED"];
type AICPErrorCode = typeof AICP_ERROR_CODES[number];
/** §5.1: 8–128 characters of A-Z a-z 0-9 . _ : - */
declare const IDEMPOTENCY_KEY_PATTERN: RegExp;
declare function isValidIdempotencyKey(value: unknown): value is string;
/** §7 webhook signature components (add "@query" when the URL has a query). */
declare const WEBHOOK_SIGNATURE_COMPONENTS: readonly ["@method", "@authority", "@path", "content-digest", "content-type", "webhook-id"];
/** §7: answer body for a webhook.verification request. */
declare function webhookVerificationResponse(event: WebhookVerificationRequest): {
    challenge: string;
};
/**
 * §7 ordering: tracks the highest order_version applied per order and tells
 * whether an event should be applied. Events without a version are applied.
 */
declare class WebhookOrderTracker {
    private readonly versions;
    private readonly seen;
    private readonly previous;
    shouldApply(event: WebhookEvent): boolean;
    /** Undo shouldApply() for an event whose processing failed, so the platform's retry is applied. */
    forget(event: WebhookEvent): void;
}
/**
 * Verifies a received webhook against the platform's published keys[] (§7).
 * Pass the exact URL the request was received on and the raw body.
 */
declare function verifyWebhookSignature(options: {
    url: string;
    headers: Headers;
    body: string;
    keys: Array<Record<string, unknown>>;
    nowSeconds?: number;
}): {
    ok: true;
} | {
    ok: false;
    code: string;
};

interface SigningKeyPair {
    /** RFC 7638 thumbprint, used as `keyid`. */
    kid: string;
    /** Send this to the platform (register / updateSettings). */
    publicJwk: PublicSigningJwk;
    /** Keep secret. Store it like a password (secret manager, never in source control). */
    privateJwk: JsonWebKey;
}
/** Generates a new ES256 (P-256, default) or Ed25519 signing key. */
declare function generateSigningKey(algorithm?: 'ES256' | 'Ed25519'): SigningKeyPair;
/** Rebuilds a SigningKeyPair from a stored private JWK (the public part is derived). */
declare function signingKeyFromPrivateJwk(privateJwk: JsonWebKey, publicJwk?: JsonWebKey): SigningKeyPair;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
interface AICPClientOptions {
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
interface PlatformDocument {
    protocol: 'AICP' | string;
    version: string;
    capabilities?: Record<string, boolean>;
    endpoints?: Record<string, string>;
    message_signatures?: Record<string, unknown>;
    webhooks?: {
        events?: string[];
        api_version?: string;
        [key: string]: unknown;
    };
    keys?: Array<Record<string, unknown>>;
    [key: string]: unknown;
}
interface RegisterAgentRequest {
    agent_name: string;
    scopes?: string[];
    /** Public JWK to bind at registration (the request is then signed with it as proof). */
    signing_jwk?: Record<string, unknown>;
    webhook_url?: string;
}
interface RegisterAgentResponse {
    agent_id: string;
    agent_name: string;
    store_name?: string;
    /** Shown exactly once. Persist it; never register again (§3.1). */
    api_key: string;
    approval_status: 'PENDING';
    scopes: string[];
    signing: {
        bound: true;
        kid: string;
    } | {
        bound: false;
    };
    webhook_url: string | null;
    integration_warning?: string;
    [key: string]: unknown;
}
interface OrderResponse {
    order_id: string;
    status: string;
    total: number;
    currency?: string;
    tracking_url?: string | null;
    idempotent_replay?: boolean;
    [key: string]: unknown;
}
declare class AICPError extends Error {
    readonly status: number;
    /** Platform error code (e.g. "agent_pending_approval"), or "network_error" / "invalid_response". */
    readonly code: string;
    readonly retryAfterSeconds: number | null;
    readonly body: unknown;
    constructor(status: number, code: string, message: string, body: unknown, retryAfterSeconds: number | null);
    /** True for failures worth retrying with the SAME Idempotency-Key. */
    get retryable(): boolean;
}
declare class AICPClient {
    private readonly baseUrl;
    private apiKey?;
    private signingKey?;
    private readonly fetchImpl;
    private readonly headers;
    private readonly timeoutMs;
    private platform?;
    constructor(options: AICPClientOptions);
    /** Use a key after register() or after loading it from your secret store. */
    setApiKey(apiKey: string): void;
    setSigningKey(key: SigningKeyPair | undefined): void;
    discover(): Promise<PlatformDocument>;
    getCapabilities(storeId: string): Promise<Record<string, unknown>>;
    getMenu(storeId: string): Promise<Record<string, unknown>>;
    getOrderSchema(storeId: string, intent?: string): Promise<AICPOrderSchema & Record<string, unknown>>;
    getAvailability(storeId: string, query?: Record<string, string | undefined>): Promise<Record<string, unknown>>;
    /**
     * Registers this agent with a store. Call ONCE per store and persist api_key;
     * on 403 or PENDING, poll me() instead of registering again (§3.1).
     * If signing_jwk is given, the request is signed with options.signingKey as proof.
     */
    register(storeId: string, body: RegisterAgentRequest): Promise<RegisterAgentResponse>;
    me(storeId: string): Promise<AgentProfile>;
    /**
     * Binds/rotates the signing key and/or sets the webhook URL (§3.3, §4.1).
     * Rotation: pass `newSigningKey`; the request is signed by the current key
     * (if any) AND the new key. On success the client switches to the new key.
     */
    updateSettings(storeId: string, settings: {
        newSigningKey?: SigningKeyPair;
        webhook_url?: string | null;
    }): Promise<Record<string, unknown>>;
    /** Pickup / catalog order or booking (§5.3, §5.4). Delivery uses prepareDelivery(). */
    createOrder(storeId: string, order: CreateOrderRequest, idempotencyKey?: string): Promise<OrderResponse>;
    /** Delivery: returns continue_url for the BUYER to confirm; no order exists yet (§5.5). */
    prepareDelivery(storeId: string, request: PrepareDeliveryRequest): Promise<PrepareDeliveryResponse>;
    /** Creates a payment intent. Never marks the order paid (§5.6). */
    createPayment(storeId: string, orderId: string, provider: PaymentProvider, idempotencyKey?: string): Promise<Record<string, unknown>>;
    /** Cancels an order this agent created and no buyer owns (§5.7). */
    cancelOrder(storeId: string, orderId: string, reason?: string): Promise<Record<string, unknown>>;
    /** §6 tracking (prefer webhooks). */
    getOrder(storeId: string, orderId: string): Promise<Record<string, unknown>>;
    private path;
    private request;
}
/** UUID v4 Idempotency-Key (§5.1). Keep it and reuse it when retrying the same operation. */
declare function newIdempotencyKey(): string;

interface WebhookHandlerOptions {
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
declare function createWebhookHandler(options: WebhookHandlerOptions): (request: Request) => Promise<Response>;

export { AICPClient, type AICPClientOptions, AICPError, type AICPErrorCode, type AICPFieldDefinition, type AICPIntent, type AICPJsonSchema, type AICPJsonSchemaProperty, type AICPMessage, type AICPOrderPayload, type AICPOrderSchema, AICP_ERROR_CODES, AICP_PROTOCOL_VERSION, AICP_WEBHOOK_API_VERSION, type AgentApprovalStatus, type AgentProfile, type CreateOrderRequest, type CurrencyCode, type FetchLike, type FieldType, IDEMPOTENCY_KEY_PATTERN, type OrderItemInput, type OrderResponse, type OrderStatus, type PaymentProvider, type PlatformDocument, type PrepareDeliveryRequest, type PrepareDeliveryResponse, type PublicSigningJwk, type RegisterAgentRequest, type RegisterAgentResponse, type SignatureFailure, type SigningKeyPair, type ValidationResult, WEBHOOK_SIGNATURE_COMPONENTS, type WebhookEvent, type WebhookHandlerOptions, WebhookOrderTracker, type WebhookVerificationRequest, contentDigest, contentDigestMatches, createWebhookHandler, generateSigningKey, isValidIdempotencyKey, jwkThumbprint, newIdempotencyKey, parsePublicSigningJwk, parseSignatureHeaders, requiredRequestComponents, signMessage, signatureBase, signingKeyFromPrivateJwk, toJsonSchema, validateAICPAnswers, verifyRequestSignature, verifyWebhookSignature, webhookVerificationResponse };
