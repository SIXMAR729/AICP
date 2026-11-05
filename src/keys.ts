// src/keys.ts — signing key helpers for agents (spec/AICP-v1.md §4.1).
import crypto from 'node:crypto';
import { jwkThumbprint, parsePublicSigningJwk, type PublicSigningJwk } from './signatures';

export interface SigningKeyPair {
  /** RFC 7638 thumbprint, used as `keyid`. */
  kid: string;
  /** Send this to the platform (register / updateSettings). */
  publicJwk: PublicSigningJwk;
  /** Keep secret. Store it like a password (secret manager, never in source control). */
  privateJwk: JsonWebKey;
}

/** Generates a new ES256 (P-256, default) or Ed25519 signing key. */
export function generateSigningKey(algorithm: 'ES256' | 'Ed25519' = 'ES256'): SigningKeyPair {
  const { publicKey, privateKey } = algorithm === 'ES256'
    ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    : crypto.generateKeyPairSync('ed25519');
  return signingKeyFromPrivateJwk(privateKey.export({ format: 'jwk' }) as JsonWebKey, publicKey.export({ format: 'jwk' }) as JsonWebKey);
}

/** Rebuilds a SigningKeyPair from a stored private JWK (the public part is derived). */
export function signingKeyFromPrivateJwk(privateJwk: JsonWebKey, publicJwk?: JsonWebKey): SigningKeyPair {
  const pub = publicJwk ?? (crypto.createPublicKey({ key: privateJwk, format: 'jwk' }).export({ format: 'jwk' }) as JsonWebKey);
  const parsed = parsePublicSigningJwk(pub);
  if (!parsed) throw new Error('Unsupported signing key: use EC P-256 or Ed25519.');
  return { kid: jwkThumbprint(parsed.jwk), publicJwk: parsed.jwk, privateJwk };
}
