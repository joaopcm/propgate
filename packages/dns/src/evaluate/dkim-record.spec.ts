import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { isTestingMode, parseDkimKey, parseDkimRecord } from "./dkim-record";

/**
 * Parsing is pure, so it gets unit tests rather than fixtures — no DNS involved.
 *
 * Keys are generated here rather than hardcoded. A pasted blob would test the
 * parser against one arbitrary key; generating covers whatever OpenSSL produces
 * today, and makes "512 bits" a fact rather than a claim about a string.
 */

function spkiBase64(modulusLength: number): string {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength });
  return publicKey.export({ format: "der", type: "spki" }).toString("base64");
}

function ed25519Base64(): string {
  const { publicKey } = generateKeyPairSync("ed25519");
  // RFC 8463 publishes the raw 32-byte key, not the SPKI wrapper.
  return publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("base64");
}

const RSA_2048 = spkiBase64(2048);
const RSA_512 = spkiBase64(512);

function record(value: string) {
  const parsed = parseDkimRecord(value);

  if (!parsed.ok) {
    throw new Error(`expected a parseable record, got ${parsed.issue}`);
  }

  return parsed.record;
}

describe("parseDkimRecord", () => {
  it("parses the tags of a normal record", () => {
    const parsed = record(`v=DKIM1; k=rsa; p=${RSA_2048}`);

    expect(parsed.version).toBe("DKIM1");
    expect(parsed.keyType).toBe("rsa");
    expect(parsed.publicKeyBase64).toBe(RSA_2048);
  });

  it("defaults k= to rsa, per the RFC", () => {
    expect(record(`v=DKIM1; p=${RSA_2048}`).keyType).toBe("rsa");
  });

  it("tolerates whitespace around tags and a trailing semicolon", () => {
    const parsed = record(`  v=DKIM1 ;  k=rsa ;  p=${RSA_2048} ;  `);

    expect(parsed.publicKeyBase64).toBe(RSA_2048);
  });

  it("keeps unknown tags rather than discarding them", () => {
    // A tag we do not model is still worth showing a customer.
    const parsed = record(`v=DKIM1; p=${RSA_2048}; n=rotated 2026-01`);

    expect(parsed.notes).toBe("rotated 2026-01");
    expect(parsed.tags.n).toBe("rotated 2026-01");
  });

  it("splits s= and t= on colons", () => {
    const parsed = record(`v=DKIM1; s=email:web; t=y:s; p=${RSA_2048}`);

    expect(parsed.serviceTypes).toEqual(["email", "web"]);
    expect(parsed.flags).toEqual(["y", "s"]);
  });

  it("rejects a version that is not DKIM1", () => {
    const parsed = parseDkimRecord(`v=DKIM2; p=${RSA_2048}`);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("wrong-version");
    }
  });

  it("rejects v= that is not the first tag", () => {
    // RFC 6376 §3.6.1 requires it first, and verifiers do enforce this.
    const parsed = parseDkimRecord(`k=rsa; v=DKIM1; p=${RSA_2048}`);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("version-not-first");
    }
  });

  it("rejects a record with no p= tag", () => {
    const parsed = parseDkimRecord("v=DKIM1; k=rsa");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("missing-p");
    }
  });

  it("rejects a duplicated tag rather than picking one", () => {
    // Which one wins is verifier-dependent, so the honest answer is neither.
    const parsed = parseDkimRecord(`v=DKIM1; p=${RSA_2048}; p=${RSA_512}`);

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("duplicate-tag");
    }
  });

  it("rejects text that contains no tags at all", () => {
    const parsed = parseDkimRecord("google-site-verification=abc");

    // That does parse as a tag, so use something that genuinely has none.
    expect(parsed.ok).toBe(false);
    expect(parseDkimRecord("just some text").ok).toBe(false);
  });

  it("rejects an empty record", () => {
    const parsed = parseDkimRecord("   ");

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) {
      expect(parsed.issue).toBe("empty");
    }
  });
});

describe("parseDkimKey", () => {
  it("reports the real modulus length of an RSA key", () => {
    const key = parseDkimKey(record(`v=DKIM1; p=${RSA_2048}`));

    expect(key).toEqual({ bits: 2048, ok: true, type: "rsa" });
  });

  it("reports 512 bits for a 512-bit key, measured rather than guessed", () => {
    const key = parseDkimKey(record(`v=DKIM1; p=${RSA_512}`));

    expect(key).toEqual({ bits: 512, ok: true, type: "rsa" });
  });

  it("treats an empty p= as revocation, not corruption", () => {
    // RFC 6376 §3.6.1. Calling this malformed would tell someone to fix a
    // record they revoked deliberately.
    const key = parseDkimKey(record("v=DKIM1; k=rsa; p="));

    expect(key.ok).toBe(false);
    if (!key.ok) {
      expect(key.issue).toBe("revoked");
    }
  });

  it("accepts folding whitespace inside the base64, which §2.10 permits", () => {
    // Every 2048-bit key is split across character-strings by necessity, and a
    // provider that rejoins the chunks with a space has produced a record every
    // conforming verifier accepts. This used to be rejected, which meant telling
    // a customer their working key was broken.
    const split = `${RSA_2048.slice(0, 100)} ${RSA_2048.slice(100)}`;
    const key = parseDkimKey(record(`v=DKIM1; p=${split}`));

    expect(key.ok).toBe(true);
  });

  it("reads the same key whether or not it was folded", () => {
    const folded = parseDkimKey(
      record(`v=DKIM1; p=${RSA_2048.slice(0, 60)}\t${RSA_2048.slice(60)}`)
    );
    const whole = parseDkimKey(record(`v=DKIM1; p=${RSA_2048}`));

    expect(folded.ok && whole.ok).toBe(true);
    if (folded.ok && whole.ok) {
      expect(folded.type).toBe(whole.type);
      expect(folded.type === "rsa" && whole.type === "rsa").toBe(true);
    }
  });

  it("still rejects a character that is not base64 and names it", () => {
    // Not a semicolon: that would be eaten by the tag-list split before the
    // key parser ever sees it.
    const key = parseDkimKey(
      record(`v=DKIM1; p=${RSA_2048.slice(0, 40)}*oops`)
    );

    expect(key.ok).toBe(false);
    if (!key.ok) {
      expect(key.issue).toBe("malformed-base64");
      expect(key.detail).toContain('"*"');
    }
  });

  it("rejects base64 that decodes to something that is not a key", () => {
    const key = parseDkimKey(record("v=DKIM1; p=bm90YWtleQ=="));

    expect(key.ok).toBe(false);
    if (!key.ok) {
      expect(key.issue).toBe("unparseable-key");
    }
  });

  it("accepts a raw 32-byte ed25519 key", () => {
    const key = parseDkimKey(
      record(`v=DKIM1; k=ed25519; p=${ed25519Base64()}`)
    );

    expect(key).toEqual({ bits: 256, ok: true, type: "ed25519" });
  });

  it("rejects an ed25519 key of the wrong length", () => {
    const key = parseDkimKey(record(`v=DKIM1; k=ed25519; p=${RSA_2048}`));

    expect(key.ok).toBe(false);
    if (!key.ok) {
      expect(key.issue).toBe("unparseable-key");
    }
  });

  it("rejects an algorithm no verifier implements", () => {
    const key = parseDkimKey(record(`v=DKIM1; k=ecdsa; p=${RSA_512}`));

    expect(key.ok).toBe(false);
    if (!key.ok) {
      expect(key.issue).toBe("unsupported-type");
    }
  });

  it("treats base64 differing only in case as a different key", () => {
    // DNS names fold case; base64 does not. Both must parse or fail on their
    // own merits rather than being silently equated.
    const lowered = RSA_2048.toLowerCase();

    expect(lowered).not.toBe(RSA_2048);
    expect(parseDkimKey(record(`v=DKIM1; p=${lowered}`)).ok).toBe(false);
  });
});

describe("isTestingMode", () => {
  it("is true only when t= contains y", () => {
    expect(isTestingMode(record(`v=DKIM1; t=y; p=${RSA_2048}`))).toBe(true);
    expect(isTestingMode(record(`v=DKIM1; t=s:y; p=${RSA_2048}`))).toBe(true);
    expect(isTestingMode(record(`v=DKIM1; t=s; p=${RSA_2048}`))).toBe(false);
    expect(isTestingMode(record(`v=DKIM1; p=${RSA_2048}`))).toBe(false);
  });
});
