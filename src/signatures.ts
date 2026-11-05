// src/signatures.ts — RFC 9421 / RFC 9530 profile used by AICP v1 (see spec/AICP-v1.md §4, §7).
/**
 * RFC 9421 HTTP Message Signatures (subset) + RFC 9530 Content-Digest.
 *
 * Profile (aligned with UCP 2026-08-25 signatures):
 *  - Keys: public JWK, EC P-256 (ES256, raw r||s) or OKP Ed25519. keyid = RFC 7638 thumbprint.
 *  - Covered components (requests): "@method" "@authority" "@path", plus "@query" when a query
 *    exists, "content-digest" and "content-type" when a body exists and "idempotency-key" when
 *    that header is sent.
 *  - Content-Digest is an RFC 9530 dictionary: a sha-256 member is required; sha-512 is checked
 *    when present; other algorithms are ignored.
 *  - Parameters: created (required, ±5 minutes), keyid (required), optional expires (≤ 1 hour).
 *  - Replay of a fresh capture is bounded by the window and by Idempotency-Key on mutations.
 */
import crypto from 'node:crypto';

export type PublicSigningJwk =
  | { kty: 'EC'; crv: 'P-256'; x: string; y: string }
  | { kty: 'OKP'; crv: 'Ed25519'; x: string };

export type SignatureFailure =
  | 'signature_missing' | 'signature_invalid' | 'signature_expired'
  | 'digest_mismatch' | 'key_not_found' | 'components_missing';

const B64URL_32 = /^[A-Za-z0-9_-]{43}$/;
const MAX_SKEW_SECONDS = 300;
const MAX_LIFETIME_SECONDS = 3600;

function b64url(buffer: Buffer) { return buffer.toString('base64url'); }

/** Validates and canonicalises a public JWK. Private material is always rejected. */
export function parsePublicSigningJwk(input: unknown): { jwk: PublicSigningJwk; kid: string } | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  for (const secret of ['d', 'p', 'q', 'dp', 'dq', 'qi', 'k']) if (secret in raw) return null;
  let jwk: PublicSigningJwk;
  if (raw.kty === 'EC' && raw.crv === 'P-256' && typeof raw.x === 'string' && typeof raw.y === 'string'
    && B64URL_32.test(raw.x) && B64URL_32.test(raw.y)) {
    jwk = { kty: 'EC', crv: 'P-256', x: raw.x, y: raw.y };
  } else if (raw.kty === 'OKP' && raw.crv === 'Ed25519' && typeof raw.x === 'string' && B64URL_32.test(raw.x)) {
    jwk = { kty: 'OKP', crv: 'Ed25519', x: raw.x };
  } else return null;
  try { crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { return null; }
  return { jwk, kid: jwkThumbprint(jwk) };
}

/** RFC 7638 thumbprint (required members, lexicographic order). */
export function jwkThumbprint(jwk: PublicSigningJwk): string {
  const canonical = jwk.kty === 'EC'
    ? JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y })
    : JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  return b64url(crypto.createHash('sha256').update(canonical).digest());
}

export function contentDigest(body: string | Buffer): string {
  return `sha-256=:${crypto.createHash('sha256').update(body).digest('base64')}:`;
}

/** Verifies an RFC 9530 Content-Digest dictionary against the body. */
export function contentDigestMatches(header: string, body: string | Buffer): boolean {
  if (header.length > 1024) return false;
  const members = new Map<string, string>();
  for (const part of header.split(',')) {
    const match = part.trim().match(/^([a-z0-9-]+)=:([A-Za-z0-9+/=]*):$/);
    if (!match || members.has(match[1])) return false;
    members.set(match[1], match[2]);
  }
  const sha256 = members.get('sha-256');
  if (!sha256) return false;
  const expected = (algorithm: string) => crypto.createHash(algorithm).update(body).digest('base64');
  if (sha256 !== expected('sha256')) return false;
  const sha512 = members.get('sha-512');
  return sha512 === undefined || sha512 === expected('sha512');
}

interface ParsedSignature {
  components: string[];
  params: Record<string, string | number>;
  /** Exact serialized inner list from Signature-Input, used verbatim for "@signature-params". */
  signatureParams: string;
  signature: Buffer;
}

function parseParams(text: string): Record<string, string | number> | null {
  const params: Record<string, string | number> = {};
  for (const part of text.split(';').slice(1)) {
    const match = part.match(/^([a-z][a-z0-9_-]*)=(?:"([^"\\]*)"|(-?\d{1,15}))$/);
    if (!match) return null;
    params[match[1]] = match[2] !== undefined ? match[2] : Number(match[3]);
  }
  return params;
}

/**
 * Parses one labelled signature. With several labels, the one whose keyid equals
 * preferKeyId wins (so a request may carry signatures by two keys, e.g. during
 * key rotation); otherwise the first label present in both headers.
 */
export function parseSignatureHeaders(signatureInput: string | null, signature: string | null, preferKeyId?: string): ParsedSignature | null {
  if (!signatureInput || !signature || signatureInput.length > 2048 || signature.length > 2048) return null;
  const inputs = new Map<string, string>();
  for (const member of signatureInput.split(/,(?=\s*[a-z][a-z0-9_-]*=\()/)) {
    const match = member.trim().match(/^([a-z][a-z0-9_-]*)=(\(.*)$/);
    if (match) inputs.set(match[1], match[2]);
  }
  const sigs = new Map<string, string>();
  for (const member of signature.split(',')) {
    const match = member.trim().match(/^([a-z][a-z0-9_-]*)=:([A-Za-z0-9+/=]+):$/);
    if (match) sigs.set(match[1], match[2]);
  }
  let first: ParsedSignature | null = null;
  for (const [label, inner] of inputs) {
    const sig = sigs.get(label);
    if (!sig) continue;
    const list = inner.match(/^\(([^()]*)\)(.*)$/);
    if (!list) return null;
    const components = list[1].trim() === '' ? [] : list[1].trim().split(/\s+/).map(item => {
      const name = item.match(/^"([@a-z0-9][a-z0-9_-]*)"$/);
      return name ? name[1] : '';
    });
    if (components.some(name => !name) || new Set(components).size !== components.length) return null;
    const params = parseParams(list[2]);
    if (!params) return null;
    const parsed = { components, params, signatureParams: inner, signature: Buffer.from(sig, 'base64') };
    if (!preferKeyId || params.keyid === preferKeyId) return parsed;
    first ??= parsed;
  }
  return first;
}

interface MessageParts { method: string; url: string; headers: Headers; status?: number }

function componentValue(name: string, message: MessageParts): string | null {
  const url = new URL(message.url);
  switch (name) {
    case '@method': return message.method.toUpperCase();
    case '@authority': return url.host.toLowerCase();
    case '@path': return url.pathname || '/';
    case '@query': return url.search || '?';
    case '@status': return message.status === undefined ? null : String(message.status);
    default: {
      if (name.startsWith('@')) return null;
      const value = message.headers.get(name);
      return value === null ? null : value.trim();
    }
  }
}

export function signatureBase(components: string[], signatureParams: string, message: MessageParts): string | null {
  const lines: string[] = [];
  for (const name of components) {
    const value = componentValue(name, message);
    if (value === null) return null;
    lines.push(`"${name}": ${value}`);
  }
  lines.push(`"@signature-params": ${signatureParams}`);
  return lines.join('\n');
}

/** Components a request must cover under this profile. */
export function requiredRequestComponents(message: MessageParts, hasBody: boolean): string[] {
  const required = ['@method', '@authority', '@path'];
  if (new URL(message.url).search) required.push('@query');
  if (hasBody) required.push('content-digest', 'content-type');
  if (message.headers.get('idempotency-key') !== null) required.push('idempotency-key');
  return required;
}

export function verifyRequestSignature(options: MessageParts & {
  body: string; jwk: PublicSigningJwk; kid: string; nowSeconds?: number;
}): { ok: true; created: number } | { ok: false; code: SignatureFailure } {
  const signatureInput = options.headers.get('signature-input');
  const signatureHeader = options.headers.get('signature');
  if (!signatureInput || !signatureHeader) return { ok: false, code: 'signature_missing' };
  const parsed = parseSignatureHeaders(signatureInput, signatureHeader, options.kid);
  if (!parsed) return { ok: false, code: 'signature_invalid' };
  if (parsed.params.keyid !== options.kid) return { ok: false, code: 'key_not_found' };
  const now = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const created = parsed.params.created, expires = parsed.params.expires;
  if (typeof created !== 'number' || Math.abs(now - created) > MAX_SKEW_SECONDS) return { ok: false, code: 'signature_expired' };
  if (expires !== undefined && (typeof expires !== 'number' || expires <= now || expires - created > MAX_LIFETIME_SECONDS)) {
    return { ok: false, code: 'signature_expired' };
  }
  const hasBody = options.body.length > 0;
  const required = requiredRequestComponents(options, hasBody);
  if (required.some(name => !parsed.components.includes(name))) return { ok: false, code: 'components_missing' };
  if (hasBody || options.headers.get('content-digest') !== null) {
    const digest = options.headers.get('content-digest');
    if (!digest || !contentDigestMatches(digest.trim(), options.body)) return { ok: false, code: 'digest_mismatch' };
  }
  const base = signatureBase(parsed.components, parsed.signatureParams, options);
  if (base === null) return { ok: false, code: 'signature_invalid' };
  try {
    const key = crypto.createPublicKey({ key: options.jwk, format: 'jwk' });
    const valid = options.jwk.kty === 'EC'
      ? crypto.verify('sha256', Buffer.from(base), { key, dsaEncoding: 'ieee-p1363' }, parsed.signature)
      : crypto.verify(null, Buffer.from(base), key, parsed.signature);
    return valid ? { ok: true, created } : { ok: false, code: 'signature_invalid' };
  } catch {
    return { ok: false, code: 'signature_invalid' };
  }
}

/** Signs an outgoing message (used for webhooks and by test clients). Returns headers to add. */
export function signMessage(options: MessageParts & {
  body: string; privateJwk: JsonWebKey; kid: string; components: string[]; nowSeconds?: number; label?: string;
}): Record<string, string> {
  const created = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const headers = new Headers(options.headers);
  const added: Record<string, string> = {};
  if (options.components.includes('content-digest')) {
    added['content-digest'] = contentDigest(options.body);
    headers.set('content-digest', added['content-digest']);
  }
  const params = `(${options.components.map(name => `"${name}"`).join(' ')});created=${created};keyid="${options.kid}"`;
  const base = signatureBase(options.components, params, { ...options, headers });
  if (base === null) throw new Error('signature_component_unavailable');
  const key = crypto.createPrivateKey({ key: options.privateJwk, format: 'jwk' });
  const signature = options.privateJwk.kty === 'EC'
    ? crypto.sign('sha256', Buffer.from(base), { key, dsaEncoding: 'ieee-p1363' })
    : crypto.sign(null, Buffer.from(base), key);
  const label = options.label ?? 'sig1';
  added['signature-input'] = `${label}=${params}`;
  added['signature'] = `${label}=:${signature.toString('base64')}:`;
  return added;
}
