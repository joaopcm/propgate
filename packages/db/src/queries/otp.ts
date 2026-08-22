import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "../client";
import { otpCodes } from "../schema/otp-codes";

export const MAX_ATTEMPTS = 5;

export const RESEND_COOLDOWN_SECONDS = 60;

export type IssueOutcome =
  | { readonly kind: "issued" }
  | { readonly kind: "throttled"; readonly retryAfterSeconds: number };

export async function issueCode(
  db: Database,
  input: {
    readonly codeHash: string;
    readonly email: string;
    readonly expiresAt: Date;
  },
  now = new Date()
): Promise<IssueOutcome> {
  const cooldownStart = new Date(
    now.getTime() - RESEND_COOLDOWN_SECONDS * 1000
  );

  const rows = await db
    .insert(otpCodes)
    .values({
      codeHash: input.codeHash,
      email: input.email,
      expiresAt: input.expiresAt,
      sentAt: now,
    })
    .onConflictDoUpdate({
      set: {
        attempts: 0,
        codeHash: input.codeHash,
        expiresAt: input.expiresAt,
        sentAt: now,
      },
      setWhere: lte(otpCodes.sentAt, cooldownStart),
      target: otpCodes.email,
      targetWhere: isNull(otpCodes.consumedAt),
    })
    .returning({ id: otpCodes.id });

  if (rows.length > 0) {
    return { kind: "issued" };
  }

  return {
    kind: "throttled",
    retryAfterSeconds: RESEND_COOLDOWN_SECONDS,
  };
}

export type ConsumeOutcome =
  | "consumed"
  | "exhausted"
  | "expired"
  | "invalid"
  | "unknown";

export async function consumeCode(
  db: Database,
  input: { readonly codeHash: string; readonly email: string },
  now = new Date()
): Promise<ConsumeOutcome> {
  const consumed = await db
    .update(otpCodes)
    .set({ consumedAt: now })
    .where(
      and(
        eq(otpCodes.email, input.email),
        eq(otpCodes.codeHash, input.codeHash),
        isNull(otpCodes.consumedAt),
        gt(otpCodes.expiresAt, now),
        lte(otpCodes.attempts, MAX_ATTEMPTS - 1)
      )
    )
    .returning({ id: otpCodes.id });

  if (consumed.length > 0) {
    return "consumed";
  }

  const charged = await db
    .update(otpCodes)
    .set({ attempts: sql`${otpCodes.attempts} + 1` })
    .where(and(eq(otpCodes.email, input.email), isNull(otpCodes.consumedAt)))
    .returning({
      attempts: otpCodes.attempts,
      expiresAt: otpCodes.expiresAt,
    });

  const [row] = charged;

  if (row === undefined) {
    return "unknown";
  }

  if (row.attempts > MAX_ATTEMPTS) {
    return "exhausted";
  }

  return row.expiresAt <= now ? "expired" : "invalid";
}
