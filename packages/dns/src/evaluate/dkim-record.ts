import { createPublicKey } from "node:crypto";

/**
 * DKIM public-key record parsing (RFC 6376 §3.6.1).
 *
 * Pure: takes the reassembled TXT value, returns what it means. No DNS here, so
 * every case below is a unit test rather than a fixture.
 *
 * The key itself is parsed with node:crypto rather than measured by base64
 * length. That is the difference between "this looks about 2048 bits" and "this
 * is a valid SPKI RSA key of exactly 2048 bits", and it catches the truncated
 * and re-wrapped keys that providers actually produce.
 */

export type DkimKeyType = "rsa" | "ed25519";

export interface DkimRecord {
  /** Flags from t=. "y" is testing mode; "s" forbids subdomain use. */
  readonly flags: readonly string[];
  readonly keyType: DkimKeyType | string;
  readonly notes: string | undefined;
  /** Raw base64 of p=, exactly as published. Empty string means revoked. */
  readonly publicKeyBase64: string;
  /** Service types from s=, defaulting to ["*"]. */
  readonly serviceTypes: readonly string[];
  /** Every tag as published, so unknown tags survive for display. */
  readonly tags: Readonly<Record<string, string | undefined>>;
  /** v=, when present. RFC 6376 requires DKIM1 if given, and it must come first. */
  readonly version: string | undefined;
}

export type DkimParseIssue =
  | "empty"
  | "no-tags"
  | "wrong-version"
  | "version-not-first"
  | "missing-p"
  | "duplicate-tag";

export type DkimParseResult =
  | { readonly ok: true; readonly record: DkimRecord }
  | {
      readonly ok: false;
      readonly issue: DkimParseIssue;
      readonly detail: string;
    };

export type DkimKeyIssue =
  | "revoked"
  | "malformed-base64"
  | "unparseable-key"
  | "unsupported-type";

export type DkimKeyResult =
  | {
      readonly ok: true;
      readonly type: "rsa";
      /** Real modulus length from the parsed key, not an estimate. */
      readonly bits: number;
    }
  | { readonly ok: true; readonly type: "ed25519"; readonly bits: 256 }
  | {
      readonly ok: false;
      readonly issue: DkimKeyIssue;
      readonly detail: string;
    };

/** Strict base64: DKIM keys are base64, and folding whitespace hides mangling. */
const STRICT_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
const ED25519_KEY_BYTES = 32;

/**
 * Split a tag-value list on semicolons.
 *
 * Whitespace *around* tags and values is legal and ignored (RFC 6376 §3.2), so
 * it is stripped here. Whitespace *inside* a base64 value is not legal, which is
 * why `parseKey` uses a strict pattern rather than stripping again — that is the
 * whole TXT_VALUE_SPLIT_MANGLED signal, and washing it out here would lose it.
 */
export function parseDkimRecord(value: string): DkimParseResult {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return { detail: "record is empty", issue: "empty", ok: false };
  }

  const pairs = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  // Explicitly optional: an absent tag reads as undefined, and saying so keeps
  // the `?? default` fallbacks below honest rather than merely defensive.
  const tags: Record<string, string | undefined> = {};
  const order: string[] = [];

  for (const pair of pairs) {
    const equals = pair.indexOf("=");

    if (equals === -1) {
      continue;
    }

    const name = pair.slice(0, equals).trim();
    const tagValue = pair.slice(equals + 1).trim();

    if (name.length === 0) {
      continue;
    }

    if (name in tags) {
      return {
        detail: `tag "${name}" appears more than once`,
        issue: "duplicate-tag",
        ok: false,
      };
    }

    tags[name] = tagValue;
    order.push(name);
  }

  if (order.length === 0) {
    return {
      detail: "no tag=value pairs found",
      issue: "no-tags",
      ok: false,
    };
  }

  const version = tags.v;

  if (version !== undefined) {
    if (version !== "DKIM1") {
      return {
        detail: `v=${version}, expected v=DKIM1`,
        issue: "wrong-version",
        ok: false,
      };
    }

    // RFC 6376 §3.6.1: "This tag MUST be the first tag in the record."
    // Verifiers that see it elsewhere may reject the key outright.
    if (order[0] !== "v") {
      return {
        detail: `v= appears after ${order[0]}=`,
        issue: "version-not-first",
        ok: false,
      };
    }
  }

  if (!("p" in tags)) {
    return {
      detail: "no p= tag, so there is no public key",
      issue: "missing-p",
      ok: false,
    };
  }

  return {
    ok: true,
    record: {
      flags: (tags.t ?? "").split(":").filter((f) => f.length > 0),
      keyType: tags.k ?? "rsa",
      notes: tags.n,
      publicKeyBase64: tags.p ?? "",
      serviceTypes: (tags.s ?? "*").split(":").filter((s) => s.length > 0),
      tags,
      version,
    },
  };
}

/**
 * Validate the public key by actually parsing it.
 *
 * An empty `p=` is not an error: RFC 6376 §3.6.1 defines it as *revocation*.
 * Treating it as malformed would tell a customer to fix a record they revoked
 * deliberately, so it gets its own issue and its own diagnosis code.
 */
export function parseDkimKey(record: DkimRecord): DkimKeyResult {
  const base64 = record.publicKeyBase64;

  if (base64.length === 0) {
    return {
      detail: "p= is empty, which RFC 6376 defines as key revocation",
      issue: "revoked",
      ok: false,
    };
  }

  if (!STRICT_BASE64.test(base64)) {
    // Almost always a provider that split the value and rejoined it with a
    // space, or wrapped it across lines. The character that broke it is worth
    // naming, since "invalid base64" alone sends people looking in the wrong place.
    const offender = [...base64].find((char) => !STRICT_BASE64.test(char));

    return {
      detail:
        offender === " "
          ? "contains a space, which usually means the value was split and rejoined incorrectly"
          : `contains ${JSON.stringify(offender ?? "?")}, which is not valid base64`,
      issue: "malformed-base64",
      ok: false,
    };
  }

  if (record.keyType === "ed25519") {
    const raw = Buffer.from(base64, "base64");

    if (raw.length !== ED25519_KEY_BYTES) {
      return {
        detail: `ed25519 keys are ${ED25519_KEY_BYTES} bytes; this is ${raw.length}`,
        issue: "unparseable-key",
        ok: false,
      };
    }

    return { bits: 256, ok: true, type: "ed25519" };
  }

  if (record.keyType !== "rsa") {
    return {
      detail: `k=${record.keyType} is not a key type verifiers understand`,
      issue: "unsupported-type",
      ok: false,
    };
  }

  try {
    const key = createPublicKey({
      format: "der",
      key: Buffer.from(base64, "base64"),
      type: "spki",
    });

    const bits = key.asymmetricKeyDetails?.modulusLength;

    if (key.asymmetricKeyType !== "rsa" || bits === undefined) {
      return {
        detail: `k=rsa but the key is ${key.asymmetricKeyType ?? "unrecognised"}`,
        issue: "unparseable-key",
        ok: false,
      };
    }

    return { bits, ok: true, type: "rsa" };
  } catch (error) {
    return {
      detail:
        error instanceof Error
          ? `not a valid RSA public key (${error.message.split("\n")[0]})`
          : "not a valid RSA public key",
      issue: "unparseable-key",
      ok: false,
    };
  }
}

/** Testing mode: receivers must not treat a failure as a real DKIM failure. */
export function isTestingMode(record: DkimRecord): boolean {
  return record.flags.includes("y");
}
