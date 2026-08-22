import { createPublicKey } from "node:crypto";

export type DkimKeyType = "rsa" | "ed25519";

export interface DkimRecord {
  readonly flags: readonly string[];
  readonly keyType: DkimKeyType | string;
  readonly notes: string | undefined;
  readonly publicKeyBase64: string;
  readonly serviceTypes: readonly string[];
  readonly tags: Readonly<Record<string, string | undefined>>;
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
      readonly bits: number;
    }
  | { readonly ok: true; readonly type: "ed25519"; readonly bits: 256 }
  | {
      readonly ok: false;
      readonly issue: DkimKeyIssue;
      readonly detail: string;
    };

const STRICT_BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const FOLDING_WHITESPACE = /[\t\n\r ]/g;
const ED25519_KEY_BYTES = 32;

export function parseDkimRecord(value: string): DkimParseResult {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return { detail: "record is empty", issue: "empty", ok: false };
  }

  const pairs = trimmed
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

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

export function parseDkimKey(record: DkimRecord): DkimKeyResult {
  const base64 = record.publicKeyBase64.replace(FOLDING_WHITESPACE, "");

  if (base64.length === 0) {
    return {
      detail: "p= is empty, which RFC 6376 defines as key revocation",
      issue: "revoked",
      ok: false,
    };
  }

  if (!STRICT_BASE64.test(base64)) {
    const offender = [...base64].find((char) => !STRICT_BASE64.test(char));

    return {
      detail: `contains ${JSON.stringify(offender ?? "?")}, which is not valid base64`,
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

export function isTestingMode(record: DkimRecord): boolean {
  return record.flags.includes("y");
}
