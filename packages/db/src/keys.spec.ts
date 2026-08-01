import { describe, expect, it } from "vitest";
import { API_KEY_PREFIX, generateApiKey, hashApiKey } from "./keys";

describe("generateApiKey", () => {
  it("never returns the same key twice", () => {
    const keys = new Set(
      Array.from({ length: 1000 }, () => generateApiKey().key)
    );

    expect(keys.size).toBe(1000);
  });

  it("carries at least 256 bits of entropy in the secret", () => {
    // The whole reason a fast hash is the right choice. base64url packs 6 bits
    // per character, so 32 random bytes land as 43 characters.
    const { key } = generateApiKey();

    expect(key.slice(API_KEY_PREFIX.length)).toHaveLength(43);
  });

  it("keeps a prefix that identifies a key without revealing it", () => {
    const { key, prefix } = generateApiKey();

    expect(key.startsWith(prefix)).toBe(true);
    // Four characters of the secret is 24 bits. What is left is still 232.
    expect(prefix).toHaveLength(API_KEY_PREFIX.length + 4);
  });

  it("stores a hash, not the key", () => {
    const { hashedKey, key } = generateApiKey();

    expect(hashedKey).not.toContain(key);
    expect(hashedKey).toBe(hashApiKey(key));
  });
});

describe("hashApiKey", () => {
  it("is stable across calls, so a key looks itself up", () => {
    expect(hashApiKey("pg_live_abc")).toBe(hashApiKey("pg_live_abc"));
  });

  it("separates keys that differ by one character", () => {
    expect(hashApiKey("pg_live_abc")).not.toBe(hashApiKey("pg_live_abd"));
  });
});
