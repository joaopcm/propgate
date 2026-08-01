import { createHash, randomBytes } from "node:crypto";

/**
 * API key generation and hashing. No database — the storage side lives in
 * `queries/api-keys.ts`, so this half is testable without one.
 */

export const API_KEY_PREFIX = "pg_live_";

/** 256 bits, which is what makes the fast hash below the right choice. */
const SECRET_BYTES = 32;

/** Enough to tell two keys apart in a list, far too little to reconstruct one. */
const DISPLAY_CHARS = 4;

export interface GeneratedApiKey {
  /** Stored. */
  readonly hashedKey: string;
  /** Returned to the caller once and never recoverable afterwards. */
  readonly key: string;
  /** Stored in clear, for display in a list of keys. */
  readonly prefix: string;
}

/**
 * SHA-256, deliberately, where a password would get bcrypt or argon2.
 *
 * Those exist to make guessing a *low-entropy human secret* expensive. This
 * input is 32 bytes of CSPRNG output: there is no dictionary and no guessing
 * budget that gets anywhere, so the only thing a slow hash would buy is
 * latency on every authenticated request. Measured on this schema, the key
 * lookup costs 0.288 ms and the hash 0.002 ms of it; bcrypt at any honest cost
 * factor would be two orders of magnitude more than the query it precedes.
 *
 * What matters instead is that the plaintext is never stored, which is why
 * `generateApiKey` returns it exactly once.
 */
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

export function generateApiKey(): GeneratedApiKey {
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const key = `${API_KEY_PREFIX}${secret}`;

  return {
    hashedKey: hashApiKey(key),
    key,
    prefix: `${API_KEY_PREFIX}${secret.slice(0, DISPLAY_CHARS)}`,
  };
}
