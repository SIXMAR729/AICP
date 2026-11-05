"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  AICPClient: () => AICPClient,
  AICPError: () => AICPError,
  AICP_ERROR_CODES: () => AICP_ERROR_CODES,
  AICP_PROTOCOL_VERSION: () => AICP_PROTOCOL_VERSION,
  AICP_WEBHOOK_API_VERSION: () => AICP_WEBHOOK_API_VERSION,
  IDEMPOTENCY_KEY_PATTERN: () => IDEMPOTENCY_KEY_PATTERN,
  WEBHOOK_SIGNATURE_COMPONENTS: () => WEBHOOK_SIGNATURE_COMPONENTS,
  WebhookOrderTracker: () => WebhookOrderTracker,
  contentDigest: () => contentDigest,
  contentDigestMatches: () => contentDigestMatches,
  createWebhookHandler: () => createWebhookHandler,
  generateSigningKey: () => generateSigningKey,
  isValidIdempotencyKey: () => isValidIdempotencyKey,
  jwkThumbprint: () => jwkThumbprint,
  newIdempotencyKey: () => newIdempotencyKey,
  parsePublicSigningJwk: () => parsePublicSigningJwk,
  parseSignatureHeaders: () => parseSignatureHeaders,
  requiredRequestComponents: () => requiredRequestComponents,
  signMessage: () => signMessage,
  signatureBase: () => signatureBase,
  signingKeyFromPrivateJwk: () => signingKeyFromPrivateJwk,
  validateAICPAnswers: () => validateAICPAnswers,
  verifyRequestSignature: () => verifyRequestSignature,
  verifyWebhookSignature: () => verifyWebhookSignature,
  webhookVerificationResponse: () => webhookVerificationResponse
});
module.exports = __toCommonJS(index_exports);

// src/validator.ts
function validateAICPAnswers(schema, payload) {
  const errors = [];
  const { answers } = payload;
  for (const reqField of schema.required) {
    if (answers[reqField] === void 0 || answers[reqField] === null || answers[reqField] === "") {
      errors.push({ field: reqField, message: `Missing required field: ${reqField}` });
    }
  }
  for (const [key, value] of Object.entries(answers)) {
    const fieldDef = schema.fields[key];
    if (!fieldDef) continue;
    if (fieldDef.pattern && typeof value === "string") {
      const regex = new RegExp(fieldDef.pattern);
      if (!regex.test(value)) {
        errors.push({ field: key, message: `Invalid format for field: ${key}. Expected pattern: ${fieldDef.pattern}` });
      }
    }
    if (fieldDef.type === "number" && typeof value === "number") {
      if (fieldDef.min !== void 0 && value < fieldDef.min) {
        errors.push({ field: key, message: `${key} must be at least ${fieldDef.min}` });
      }
      if (fieldDef.max !== void 0 && value > fieldDef.max) {
        errors.push({ field: key, message: `${key} must be at most ${fieldDef.max}` });
      }
    }
  }
  return {
    isValid: errors.length === 0,
    errors
  };
}

// src/signatures.ts
var import_node_crypto = __toESM(require("crypto"));
var B64URL_32 = /^[A-Za-z0-9_-]{43}$/;
var MAX_SKEW_SECONDS = 300;
var MAX_LIFETIME_SECONDS = 3600;
function b64url(buffer) {
  return buffer.toString("base64url");
}
function parsePublicSigningJwk(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input;
  for (const secret of ["d", "p", "q", "dp", "dq", "qi", "k"]) if (secret in raw) return null;
  let jwk;
  if (raw.kty === "EC" && raw.crv === "P-256" && typeof raw.x === "string" && typeof raw.y === "string" && B64URL_32.test(raw.x) && B64URL_32.test(raw.y)) {
    jwk = { kty: "EC", crv: "P-256", x: raw.x, y: raw.y };
  } else if (raw.kty === "OKP" && raw.crv === "Ed25519" && typeof raw.x === "string" && B64URL_32.test(raw.x)) {
    jwk = { kty: "OKP", crv: "Ed25519", x: raw.x };
  } else return null;
  try {
    import_node_crypto.default.createPublicKey({ key: jwk, format: "jwk" });
  } catch {
    return null;
  }
  return { jwk, kid: jwkThumbprint(jwk) };
}
function jwkThumbprint(jwk) {
  const canonical = jwk.kty === "EC" ? JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y }) : JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return b64url(import_node_crypto.default.createHash("sha256").update(canonical).digest());
}
function contentDigest(body) {
  return `sha-256=:${import_node_crypto.default.createHash("sha256").update(body).digest("base64")}:`;
}
function contentDigestMatches(header, body) {
  if (header.length > 1024) return false;
  const members = /* @__PURE__ */ new Map();
  for (const part of header.split(",")) {
    const match = part.trim().match(/^([a-z0-9-]+)=:([A-Za-z0-9+/=]*):$/);
    if (!match || members.has(match[1])) return false;
    members.set(match[1], match[2]);
  }
  const sha256 = members.get("sha-256");
  if (!sha256) return false;
  const expected = (algorithm) => import_node_crypto.default.createHash(algorithm).update(body).digest("base64");
  if (sha256 !== expected("sha256")) return false;
  const sha512 = members.get("sha-512");
  return sha512 === void 0 || sha512 === expected("sha512");
}
function parseParams(text) {
  const params = {};
  for (const part of text.split(";").slice(1)) {
    const match = part.match(/^([a-z][a-z0-9_-]*)=(?:"([^"\\]*)"|(-?\d{1,15}))$/);
    if (!match) return null;
    params[match[1]] = match[2] !== void 0 ? match[2] : Number(match[3]);
  }
  return params;
}
function parseSignatureHeaders(signatureInput, signature, preferKeyId) {
  if (!signatureInput || !signature || signatureInput.length > 2048 || signature.length > 2048) return null;
  const inputs = /* @__PURE__ */ new Map();
  for (const member of signatureInput.split(/,(?=\s*[a-z][a-z0-9_-]*=\()/)) {
    const match = member.trim().match(/^([a-z][a-z0-9_-]*)=(\(.*)$/);
    if (match) inputs.set(match[1], match[2]);
  }
  const sigs = /* @__PURE__ */ new Map();
  for (const member of signature.split(",")) {
    const match = member.trim().match(/^([a-z][a-z0-9_-]*)=:([A-Za-z0-9+/=]+):$/);
    if (match) sigs.set(match[1], match[2]);
  }
  let first = null;
  for (const [label, inner] of inputs) {
    const sig = sigs.get(label);
    if (!sig) continue;
    const list = inner.match(/^\(([^()]*)\)(.*)$/);
    if (!list) return null;
    const components = list[1].trim() === "" ? [] : list[1].trim().split(/\s+/).map((item) => {
      const name = item.match(/^"([@a-z0-9][a-z0-9_-]*)"$/);
      return name ? name[1] : "";
    });
    if (components.some((name) => !name) || new Set(components).size !== components.length) return null;
    const params = parseParams(list[2]);
    if (!params) return null;
    const parsed = { components, params, signatureParams: inner, signature: Buffer.from(sig, "base64") };
    if (!preferKeyId || params.keyid === preferKeyId) return parsed;
    first ??= parsed;
  }
  return first;
}
function componentValue(name, message) {
  const url = new URL(message.url);
  switch (name) {
    case "@method":
      return message.method.toUpperCase();
    case "@authority":
      return url.host.toLowerCase();
    case "@path":
      return url.pathname || "/";
    case "@query":
      return url.search || "?";
    case "@status":
      return message.status === void 0 ? null : String(message.status);
    default: {
      if (name.startsWith("@")) return null;
      const value = message.headers.get(name);
      return value === null ? null : value.trim();
    }
  }
}
function signatureBase(components, signatureParams, message) {
  const lines = [];
  for (const name of components) {
    const value = componentValue(name, message);
    if (value === null) return null;
    lines.push(`"${name}": ${value}`);
  }
  lines.push(`"@signature-params": ${signatureParams}`);
  return lines.join("\n");
}
function requiredRequestComponents(message, hasBody) {
  const required = ["@method", "@authority", "@path"];
  if (new URL(message.url).search) required.push("@query");
  if (hasBody) required.push("content-digest", "content-type");
  if (message.headers.get("idempotency-key") !== null) required.push("idempotency-key");
  return required;
}
function verifyRequestSignature(options) {
  const signatureInput = options.headers.get("signature-input");
  const signatureHeader = options.headers.get("signature");
  if (!signatureInput || !signatureHeader) return { ok: false, code: "signature_missing" };
  const parsed = parseSignatureHeaders(signatureInput, signatureHeader, options.kid);
  if (!parsed) return { ok: false, code: "signature_invalid" };
  if (parsed.params.keyid !== options.kid) return { ok: false, code: "key_not_found" };
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1e3);
  const created = parsed.params.created, expires = parsed.params.expires;
  if (typeof created !== "number" || Math.abs(now - created) > MAX_SKEW_SECONDS) return { ok: false, code: "signature_expired" };
  if (expires !== void 0 && (typeof expires !== "number" || expires <= now || expires - created > MAX_LIFETIME_SECONDS)) {
    return { ok: false, code: "signature_expired" };
  }
  const hasBody = options.body.length > 0;
  const required = requiredRequestComponents(options, hasBody);
  if (required.some((name) => !parsed.components.includes(name))) return { ok: false, code: "components_missing" };
  if (hasBody || options.headers.get("content-digest") !== null) {
    const digest = options.headers.get("content-digest");
    if (!digest || !contentDigestMatches(digest.trim(), options.body)) return { ok: false, code: "digest_mismatch" };
  }
  const base = signatureBase(parsed.components, parsed.signatureParams, options);
  if (base === null) return { ok: false, code: "signature_invalid" };
  try {
    const key = import_node_crypto.default.createPublicKey({ key: options.jwk, format: "jwk" });
    const valid = options.jwk.kty === "EC" ? import_node_crypto.default.verify("sha256", Buffer.from(base), { key, dsaEncoding: "ieee-p1363" }, parsed.signature) : import_node_crypto.default.verify(null, Buffer.from(base), key, parsed.signature);
    return valid ? { ok: true, created } : { ok: false, code: "signature_invalid" };
  } catch {
    return { ok: false, code: "signature_invalid" };
  }
}
function signMessage(options) {
  const created = options.nowSeconds ?? Math.floor(Date.now() / 1e3);
  const headers = new Headers(options.headers);
  const added = {};
  if (options.components.includes("content-digest")) {
    added["content-digest"] = contentDigest(options.body);
    headers.set("content-digest", added["content-digest"]);
  }
  const params = `(${options.components.map((name) => `"${name}"`).join(" ")});created=${created};keyid="${options.kid}"`;
  const base = signatureBase(options.components, params, { ...options, headers });
  if (base === null) throw new Error("signature_component_unavailable");
  const key = import_node_crypto.default.createPrivateKey({ key: options.privateJwk, format: "jwk" });
  const signature = options.privateJwk.kty === "EC" ? import_node_crypto.default.sign("sha256", Buffer.from(base), { key, dsaEncoding: "ieee-p1363" }) : import_node_crypto.default.sign(null, Buffer.from(base), key);
  const label = options.label ?? "sig1";
  added["signature-input"] = `${label}=${params}`;
  added["signature"] = `${label}=:${signature.toString("base64")}:`;
  return added;
}

// src/protocol.ts
var AICP_PROTOCOL_VERSION = "1.0";
var AICP_WEBHOOK_API_VERSION = "2026-10-21";
var AICP_ERROR_CODES = [
  "agent_pending_approval",
  "agent_key_expired",
  "agent_key_revoked",
  "invalid_idempotency_key",
  "signature_missing",
  "signature_required",
  "signature_invalid",
  "signature_expired",
  "key_not_found",
  "components_missing",
  "digest_mismatch",
  "signing_key_proof_required",
  "signing_key_removal_forbidden",
  "settings_signature_replayed",
  "webhook_url_invalid",
  "webhook_url_not_public",
  "webhook_verification_failed",
  "buyer_owned_transaction",
  "RATE_LIMIT_EXCEEDED",
  // Transactions (reference implementation)
  "invalid_request",
  "COMMERCE_MUTATIONS_DISABLED",
  "agent_pending_quota_exceeded",
  "DELIVERY_BUYER_CONFIRMATION_REQUIRED",
  "availability_slot_not_found",
  "slot_offering_not_available",
  "invalid_authoritative_price",
  "idempotency_payload_mismatch",
  "store_currently_closed",
  "CASH_DELIVERY_NOT_ENABLED",
  "DELIVERY_OUT_OF_RANGE",
  "DELIVERY_ADDRESS_REQUIRED",
  "SCHEMA_VALIDATION_FAILED"
];
var IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
function isValidIdempotencyKey(value) {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}
var WEBHOOK_SIGNATURE_COMPONENTS = ["@method", "@authority", "@path", "content-digest", "content-type", "webhook-id"];
function webhookVerificationResponse(event) {
  return { challenge: event.data.challenge };
}
var WebhookOrderTracker = class {
  versions = /* @__PURE__ */ new Map();
  seen = /* @__PURE__ */ new Set();
  previous = /* @__PURE__ */ new Map();
  shouldApply(event) {
    if (this.seen.has(event.id)) return false;
    this.seen.add(event.id);
    const version = event.data.order_version;
    if (typeof version !== "number") return true;
    const applied = this.versions.get(event.data.order_id);
    if (applied !== void 0 && version < applied) return false;
    this.previous.set(event.id, applied);
    this.versions.set(event.data.order_id, version);
    return true;
  }
  /** Undo shouldApply() for an event whose processing failed, so the platform's retry is applied. */
  forget(event) {
    this.seen.delete(event.id);
    if (!this.previous.has(event.id)) return;
    const before = this.previous.get(event.id);
    this.previous.delete(event.id);
    if (this.versions.get(event.data.order_id) !== event.data.order_version) return;
    if (before === void 0) this.versions.delete(event.data.order_id);
    else this.versions.set(event.data.order_id, before);
  }
};
function verifyWebhookSignature(options) {
  const input = options.headers.get("signature-input") ?? "";
  const keyid = input.match(/keyid="([A-Za-z0-9_-]{43})"/)?.[1];
  const published = options.keys.find((key) => key.kid === keyid);
  const parsed = published ? parsePublicSigningJwk(published) : null;
  if (!keyid || !parsed || parsed.kid !== keyid) return { ok: false, code: "key_not_found" };
  const result = verifyRequestSignature({
    method: "POST",
    url: options.url,
    headers: options.headers,
    body: options.body,
    jwk: parsed.jwk,
    kid: parsed.kid,
    nowSeconds: options.nowSeconds
  });
  if (!result.ok) return result;
  const required = new URL(options.url).search ? [...WEBHOOK_SIGNATURE_COMPONENTS, "@query"] : WEBHOOK_SIGNATURE_COMPONENTS;
  const covered = input.match(/\(([^)]*)\)/)?.[1] ?? "";
  return required.every((name) => covered.includes(`"${name}"`)) ? { ok: true } : { ok: false, code: "components_missing" };
}

// src/keys.ts
var import_node_crypto2 = __toESM(require("crypto"));
function generateSigningKey(algorithm = "ES256") {
  const { publicKey, privateKey } = algorithm === "ES256" ? import_node_crypto2.default.generateKeyPairSync("ec", { namedCurve: "P-256" }) : import_node_crypto2.default.generateKeyPairSync("ed25519");
  return signingKeyFromPrivateJwk(privateKey.export({ format: "jwk" }), publicKey.export({ format: "jwk" }));
}
function signingKeyFromPrivateJwk(privateJwk, publicJwk) {
  const pub = publicJwk ?? import_node_crypto2.default.createPublicKey({ key: privateJwk, format: "jwk" }).export({ format: "jwk" });
  const parsed = parsePublicSigningJwk(pub);
  if (!parsed) throw new Error("Unsupported signing key: use EC P-256 or Ed25519.");
  return { kid: jwkThumbprint(parsed.jwk), publicJwk: parsed.jwk, privateJwk };
}

// src/client.ts
var import_node_crypto3 = __toESM(require("crypto"));
var AICPError = class extends Error {
  status;
  /** Platform error code (e.g. "agent_pending_approval"), or "network_error" / "invalid_response". */
  code;
  retryAfterSeconds;
  body;
  constructor(status, code, message, body, retryAfterSeconds) {
    super(message);
    this.name = "AICPError";
    this.status = status;
    this.code = code;
    this.body = body;
    this.retryAfterSeconds = retryAfterSeconds;
  }
  /** True for failures worth retrying with the SAME Idempotency-Key. */
  get retryable() {
    return this.code === "network_error" || this.status === 429 || this.status === 502 || this.status === 503 || this.status === 504;
  }
};
var DEFAULT_PATHS = {
  store_capabilities: "/api/v1/commerce/store/{storeId}/capabilities",
  store_menu: "/api/v1/commerce/store/{storeId}/menu",
  store_order_schema: "/api/v1/commerce/store/{storeId}/order-schema",
  store_availability: "/api/v1/commerce/store/{storeId}/availability",
  agent_register: "/api/v1/commerce/store/{storeId}/agents/register",
  agent_me: "/api/v1/commerce/store/{storeId}/agents/me",
  agent_settings: "/api/v1/commerce/store/{storeId}/agents/me/settings",
  orders: "/api/v1/commerce/store/{storeId}/orders",
  orders_prepare: "/api/v1/commerce/store/{storeId}/orders/prepare",
  order: "/api/v1/commerce/store/{storeId}/orders/{orderId}",
  order_payment: "/api/v1/commerce/store/{storeId}/orders/{orderId}/payment",
  order_cancel: "/api/v1/commerce/store/{storeId}/orders/{orderId}/cancel"
};
var PLATFORM_ENDPOINT_NAMES = {
  store_menu: "store_catalog",
  store_order_schema: "store_contract",
  agent_me: "agent_identity",
  orders: "store_transaction",
  orders_prepare: "external_delivery_prepare",
  order_payment: "payment_intent",
  order_cancel: "store_cancel"
};
var AICPClient = class {
  baseUrl;
  apiKey;
  signingKey;
  fetchImpl;
  headers;
  timeoutMs;
  platform;
  constructor(options) {
    const url = new URL(options.baseUrl);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error("AICP baseUrl must use https (http is allowed only for localhost).");
    }
    this.baseUrl = url.origin;
    this.apiKey = options.apiKey;
    this.signingKey = options.signingKey;
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error("No fetch implementation available (Node 18+ or pass options.fetch).");
    this.fetchImpl = fetchImpl;
    this.headers = options.headers ?? {};
    this.timeoutMs = options.timeoutMs ?? 15e3;
  }
  /** Use a key after register() or after loading it from your secret store. */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }
  setSigningKey(key) {
    this.signingKey = key;
  }
  // ── §2 Discovery ──────────────────────────────────────────────────────────
  async discover() {
    const doc = await this.request("GET", "/.well-known/aicp.json", { auth: false });
    if (!doc || doc.protocol !== "AICP") throw new AICPError(200, "invalid_response", "Not an AICP platform document.", doc, null);
    this.platform = doc;
    return doc;
  }
  async getCapabilities(storeId) {
    return this.request("GET", this.path("store_capabilities", { storeId }), { auth: false });
  }
  async getMenu(storeId) {
    return this.request("GET", this.path("store_menu", { storeId }), { auth: false });
  }
  async getOrderSchema(storeId, intent = "order") {
    return this.request("GET", this.path("store_order_schema", { storeId }), { auth: false, query: { intent } });
  }
  async getAvailability(storeId, query) {
    return this.request("GET", this.path("store_availability", { storeId }), { auth: false, query });
  }
  // ── §3 Agent identity ─────────────────────────────────────────────────────
  /**
   * Registers this agent with a store. Call ONCE per store and persist api_key;
   * on 403 or PENDING, poll me() instead of registering again (§3.1).
   * If signing_jwk is given, the request is signed with options.signingKey as proof.
   */
  async register(storeId, body) {
    const result = await this.request("POST", this.path("agent_register", { storeId }), { auth: false, body });
    if (typeof result.api_key === "string") this.apiKey = result.api_key;
    return result;
  }
  async me(storeId) {
    return this.request("GET", this.path("agent_me", { storeId }));
  }
  /**
   * Binds/rotates the signing key and/or sets the webhook URL (§3.3, §4.1).
   * Rotation: pass `newSigningKey`; the request is signed by the current key
   * (if any) AND the new key. On success the client switches to the new key.
   */
  async updateSettings(storeId, settings) {
    const body = {};
    if (settings.newSigningKey) body.signing_jwk = settings.newSigningKey.publicJwk;
    if (settings.webhook_url !== void 0) body.webhook_url = settings.webhook_url;
    const result = await this.request("POST", this.path("agent_settings", { storeId }), {
      body,
      extraSigners: settings.newSigningKey ? [settings.newSigningKey] : void 0
    });
    if (settings.newSigningKey) this.signingKey = settings.newSigningKey;
    return result;
  }
  // ── §5 Transactions ───────────────────────────────────────────────────────
  /** Pickup / catalog order or booking (§5.3, §5.4). Delivery uses prepareDelivery(). */
  async createOrder(storeId, order, idempotencyKey) {
    return this.request("POST", this.path("orders", { storeId }), { body: order, idempotencyKey: idempotencyKey ?? newIdempotencyKey() });
  }
  /** Delivery: returns continue_url for the BUYER to confirm; no order exists yet (§5.5). */
  async prepareDelivery(storeId, request) {
    return this.request("POST", this.path("orders_prepare", { storeId }), { body: request });
  }
  /** Creates a payment intent. Never marks the order paid (§5.6). */
  async createPayment(storeId, orderId, provider, idempotencyKey) {
    return this.request("POST", this.path("order_payment", { storeId, orderId }), {
      body: { provider },
      idempotencyKey: idempotencyKey ?? newIdempotencyKey()
    });
  }
  /** Cancels an order this agent created and no buyer owns (§5.7). */
  async cancelOrder(storeId, orderId, reason) {
    return this.request("POST", this.path("order_cancel", { storeId, orderId }), { body: reason ? { reason } : {} });
  }
  /** §6 tracking (prefer webhooks). */
  async getOrder(storeId, orderId) {
    return this.request("GET", this.path("order", { storeId, orderId }));
  }
  // ── internals ─────────────────────────────────────────────────────────────
  path(name, params) {
    const published = this.platform?.endpoints?.[PLATFORM_ENDPOINT_NAMES[name] ?? name];
    const template = published ?? DEFAULT_PATHS[name];
    if (!template) throw new Error(`Unknown AICP endpoint: ${name}`);
    let out = template.replace(/\{\?[^}]*\}/g, "");
    for (const [key, value] of Object.entries(params)) {
      if (!value || /[/?#\s]/.test(value)) throw new Error(`Invalid ${key}`);
      out = out.split(`{${key}}`).join(encodeURIComponent(value));
    }
    if (/\{[a-zA-Z]+\}/.test(out)) throw new Error(`Missing path parameter in ${template}`);
    return out;
  }
  async request(method, pathOrUrl, options = {}) {
    const url = new URL(pathOrUrl, this.baseUrl);
    if (url.origin !== this.baseUrl) throw new Error("Endpoint must stay on the platform origin.");
    for (const [key, value] of Object.entries(options.query ?? {})) if (value !== void 0) url.searchParams.set(key, value);
    const headers = new Headers({ accept: "application/json", ...this.headers });
    const body = options.body === void 0 ? "" : JSON.stringify(options.body);
    if (body) headers.set("content-type", "application/json");
    if (options.auth !== false) {
      if (!this.apiKey) throw new Error("apiKey is required for this call (register() or setApiKey()).");
      headers.set("authorization", `Bearer ${this.apiKey}`);
    }
    if (options.idempotencyKey !== void 0) {
      if (!isValidIdempotencyKey(options.idempotencyKey)) throw new Error("Idempotency-Key must be 8\u2013128 chars of A-Z a-z 0-9 . _ : -");
      headers.set("idempotency-key", options.idempotencyKey);
    }
    const signers = [this.signingKey, ...options.extraSigners ?? []].filter((k, i, all) => Boolean(k) && all.findIndex((o) => o?.kid === k.kid) === i);
    if (signers.length) {
      const components = requiredRequestComponents({ method, url: url.toString(), headers }, body.length > 0);
      const inputs = [], sigs = [];
      signers.forEach((key, index) => {
        const added = signMessage({
          method,
          url: url.toString(),
          headers,
          body,
          privateJwk: key.privateJwk,
          kid: key.kid,
          components,
          label: `sig${index + 1}`
        });
        if (added["content-digest"]) headers.set("content-digest", added["content-digest"]);
        inputs.push(added["signature-input"]);
        sigs.push(added["signature"]);
      });
      headers.set("signature-input", inputs.join(", "));
      headers.set("signature", sigs.join(", "));
    }
    let response;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      response = await this.fetchImpl(url.toString(), { method, headers, body: body || void 0, signal: controller.signal, redirect: "error" });
    } catch (error) {
      throw new AICPError(0, "network_error", error instanceof Error ? error.message : "Network error", null, null);
    } finally {
      clearTimeout(timer);
    }
    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    if (!response.ok) {
      const record = data && typeof data === "object" ? data : {};
      const code = typeof record.error === "string" ? record.error : typeof record.code === "string" ? record.code : `http_${response.status}`;
      const message = typeof record.message === "string" ? record.message : code;
      const retry = Number(response.headers.get("retry-after"));
      throw new AICPError(response.status, code, message, data, Number.isFinite(retry) && retry >= 0 ? retry : null);
    }
    if (data === null || typeof data !== "object") throw new AICPError(response.status, "invalid_response", "Expected a JSON object.", data, null);
    return data;
  }
};
function newIdempotencyKey() {
  return import_node_crypto3.default.randomUUID();
}

// src/webhooks.ts
function createWebhookHandler(options) {
  const tracker = options.tracker ?? new WebhookOrderTracker();
  return async function handle(request) {
    if (request.method !== "POST") return new Response("method_not_allowed", { status: 405 });
    const body = await request.text();
    if (body.length > 65536) return new Response("payload_too_large", { status: 413 });
    const keys = typeof options.keys === "function" ? await options.keys() : options.keys;
    const url = options.publicUrl ?? request.url;
    const verified = verifyWebhookSignature({ url, headers: request.headers, body, keys });
    if (!verified.ok) return Response.json({ error: verified.code }, { status: 401 });
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return Response.json({ error: "invalid_json" }, { status: 400 });
    }
    if (payload.type === "webhook.verification") return Response.json(webhookVerificationResponse(payload));
    if (payload.type !== "order.created" && payload.type !== "order.updated") return new Response(null, { status: 204 });
    if (!tracker.shouldApply(payload)) return new Response(null, { status: 204 });
    try {
      await options.onEvent(payload);
    } catch {
      tracker.forget?.(payload);
      return Response.json({ error: "handler_failed" }, { status: 500 });
    }
    return new Response(null, { status: 204 });
  };
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  AICPClient,
  AICPError,
  AICP_ERROR_CODES,
  AICP_PROTOCOL_VERSION,
  AICP_WEBHOOK_API_VERSION,
  IDEMPOTENCY_KEY_PATTERN,
  WEBHOOK_SIGNATURE_COMPONENTS,
  WebhookOrderTracker,
  contentDigest,
  contentDigestMatches,
  createWebhookHandler,
  generateSigningKey,
  isValidIdempotencyKey,
  jwkThumbprint,
  newIdempotencyKey,
  parsePublicSigningJwk,
  parseSignatureHeaders,
  requiredRequestComponents,
  signMessage,
  signatureBase,
  signingKeyFromPrivateJwk,
  validateAICPAnswers,
  verifyRequestSignature,
  verifyWebhookSignature,
  webhookVerificationResponse
});
