import { createHash, randomBytes } from "node:crypto";

export const API_KEY_PREFIX = "pg_live_";

const SECRET_BYTES = 32;

const DISPLAY_CHARS = 4;

export interface GeneratedApiKey {
  readonly hashedKey: string;
  readonly key: string;
  readonly prefix: string;
}

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
