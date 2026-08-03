import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * The signature a customer writes code against.
 *
 * Svix-compatible on the wire, per `docs/DESIGN.md`'s scope table: three headers,
 * `v1,<base64 HMAC-SHA256>` over `{id}.{timestamp}.{body}`. That is not
 * admiration for Svix — it is that swapping in Svix later then changes nothing
 * for anyone who has already integrated, and until then their verification
 * libraries and every published example already work against us.
 *
 * Deliberately its own package with no dependencies beyond `node:crypto`. This is
 * the part that has to be independently testable against a fixed vector, because
 * a refactor that silently changes the signing input breaks every customer at
 * once and does so invisibly — our side keeps signing happily.
 */

/** What goes in the `webhook-secret` a customer copies out of the API. */
const SECRET_PREFIX = "whsec_";
const SECRET_BYTES = 24;

/**
 * How far a timestamp may be from now before a receiver should reject it.
 *
 * Five minutes, which is the Svix default and therefore what every existing
 * verification library already enforces. Publishing a different number would mean
 * customers using a stock library silently disagreeing with our documentation.
 *
 * We do not enforce this — the receiver does. It is exported so the docs and any
 * SDK quote one number rather than two.
 */
export const TOLERANCE_SECONDS = 300;

export interface SignedHeaders {
  readonly "webhook-id": string;
  readonly "webhook-signature": string;
  readonly "webhook-timestamp": string;
}

export function generateSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64")}`;
}

/**
 * The bytes an HMAC is keyed with.
 *
 * The `whsec_` prefix is a label for humans and is *not* part of the key, and the
 * remainder is base64. Getting this wrong is the single most common way an
 * integration produces signatures that never match while looking correct on both
 * sides.
 */
function keyOf(secret: string): Buffer {
  const body = secret.startsWith(SECRET_PREFIX)
    ? secret.slice(SECRET_PREFIX.length)
    : secret;

  return Buffer.from(body, "base64");
}

/**
 * Exactly what is signed.
 *
 * The id and the timestamp are inside the signature, not merely alongside it.
 * Without the timestamp a captured request replays forever; without the id a
 * body signed for one delivery can be replayed as another. Both are the reason
 * this is a function rather than three concatenations at the call site.
 */
function signedPayload(id: string, timestamp: number, body: string): string {
  return `${id}.${timestamp}.${body}`;
}

function signatureFor(secret: string, content: string): string {
  return `v1,${createHmac("sha256", keyOf(secret)).update(content).digest("base64")}`;
}

export interface SignOptions {
  readonly body: string;
  readonly id: string;
  /**
   * Every secret to sign with, newest first.
   *
   * More than one during a rotation window. Both signatures go in the header
   * space-separated, which is how the Svix format expresses this — a receiver
   * checks whether *any* of them matches, so a customer who has moved to the new
   * secret and one who has not are both still working. That is the whole reason
   * rotation is two secrets rather than a hard swap: a swap breaks whoever has
   * not redeployed, precisely during the one operation you perform because you
   * think a secret has leaked.
   */
  readonly secrets: readonly string[];
  /** Unix seconds. Injected rather than read, so signing is a pure function. */
  readonly timestamp: number;
}

export function signPayload(options: SignOptions): SignedHeaders {
  if (options.secrets.length === 0) {
    throw new Error(
      "signPayload needs at least one secret; an unsigned webhook is worse than none, because a receiver cannot tell it from a forgery"
    );
  }

  const content = signedPayload(options.id, options.timestamp, options.body);

  return {
    "webhook-id": options.id,
    "webhook-signature": options.secrets
      .map((secret) => signatureFor(secret, content))
      .join(" "),
    "webhook-timestamp": String(options.timestamp),
  };
}

export interface VerifyOptions {
  readonly body: string;
  readonly header: string;
  readonly id: string;
  readonly secret: string;
  readonly timestamp: number;
}

/**
 * The receiver's side, which exists so the documented snippet is tested.
 *
 * A verification example nobody runs is an example that rots. This is the same
 * code the docs page will show, so a change that breaks customers breaks a spec
 * first.
 *
 * Constant-time comparison, and length-checked before it: `timingSafeEqual`
 * throws on a length mismatch rather than returning false, which would turn a
 * malformed header into a 500 instead of a rejection.
 */
export function verifyPayload(options: VerifyOptions): boolean {
  const expected = signatureFor(
    options.secret,
    signedPayload(options.id, options.timestamp, options.body)
  );
  const expectedBytes = Buffer.from(expected);

  // Any one of the space-separated signatures matching is a pass. During a
  // rotation window the header carries two and only one of them is ours.
  return options.header.split(" ").some((candidate) => {
    const candidateBytes = Buffer.from(candidate.trim());

    return (
      candidateBytes.length === expectedBytes.length &&
      timingSafeEqual(candidateBytes, expectedBytes)
    );
  });
}
