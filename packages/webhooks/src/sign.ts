import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET_PREFIX = "whsec_";
const SECRET_BYTES = 24;

export const TOLERANCE_SECONDS = 300;

export interface SignedHeaders {
  readonly "webhook-id": string;
  readonly "webhook-signature": string;
  readonly "webhook-timestamp": string;
}

export function generateSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64")}`;
}

function keyOf(secret: string): Buffer {
  const body = secret.startsWith(SECRET_PREFIX)
    ? secret.slice(SECRET_PREFIX.length)
    : secret;

  return Buffer.from(body, "base64");
}

function signedPayload(id: string, timestamp: number, body: string): string {
  return `${id}.${timestamp}.${body}`;
}

function signatureFor(secret: string, content: string): string {
  return `v1,${createHmac("sha256", keyOf(secret)).update(content).digest("base64")}`;
}

export interface SignOptions {
  readonly body: string;
  readonly id: string;
  readonly secrets: readonly string[];
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

export function verifyPayload(options: VerifyOptions): boolean {
  const expected = signatureFor(
    options.secret,
    signedPayload(options.id, options.timestamp, options.body)
  );
  const expectedBytes = Buffer.from(expected);

  return options.header.split(" ").some((candidate) => {
    const candidateBytes = Buffer.from(candidate.trim());

    return (
      candidateBytes.length === expectedBytes.length &&
      timingSafeEqual(candidateBytes, expectedBytes)
    );
  });
}
