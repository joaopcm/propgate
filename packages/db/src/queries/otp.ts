import { and, eq, gt, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "../client";
import { otpCodes } from "../schema/otp-codes";

/**
 * Issuing and consuming confirmation codes.
 *
 * **A correction to the plan.** It said a repeat request re-sends *the same* code.
 * That is impossible here and the impossibility is the point: only a hash is
 * stored, so the code cannot be recovered to be re-sent. What actually happens is
 * that a repeat request past the cooldown **replaces** the live code with a new
 * one — which preserves the property that mattered (exactly one valid code per
 * address, so a storm cannot fan out) while keeping the store hash-only. Storing
 * something recoverable in order to re-send the same digits would trade the
 * database's safety for a cosmetic nicety.
 */

/**
 * Wrong guesses allowed before a code is dead.
 *
 * Five. With six digits that leaves a 1-in-200,000 chance across a code's whole
 * life, and the cap rather than the length is what does the work — which is why
 * the codes stay short enough to type from a notification.
 */
export const MAX_ATTEMPTS = 5;

/**
 * How long before the same address can be mailed again.
 *
 * Sixty seconds. Long enough that a double-clicked form sends one message, short
 * enough that somebody who genuinely lost the first mail is not stuck. It is not
 * the abuse control — the per-IP limiter is — it is what stops one address being
 * mailbombed from one place.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

export type IssueOutcome =
  | { readonly kind: "issued" }
  | { readonly kind: "throttled"; readonly retryAfterSeconds: number };

/**
 * Put a fresh code against an address, unless one was just sent.
 *
 * One statement. `on conflict … do update … where sent_at <= cooldown` means the
 * cooldown is enforced by Postgres rather than by a read followed by a write, so
 * two simultaneous signups for one address cannot both send.
 *
 * `attempts` resets on re-issue: a new code deserves its own budget, and carrying
 * the old count over would let somebody lock an address out of signing up by
 * guessing at it.
 */
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

/**
 * Why a code was not accepted.
 *
 * The route collapses every failure into one response, because telling a caller
 * which kind of wrong they were is an oracle: "expired" confirms the address
 * signed up, and "exhausted" confirms somebody is guessing at it. These exist for
 * the log, not for the client.
 */
export type ConsumeOutcome =
  | "consumed"
  | "exhausted"
  | "expired"
  | "invalid"
  | "unknown";

/**
 * Spend a code, or say why not.
 *
 * The accepting path is **one conditional update**. A read followed by a write
 * lets two concurrent confirms both succeed and mint two keys — the same class of
 * bug `FOR UPDATE SKIP LOCKED` prevents in the sweeper, and the reason the
 * predicate lives in the `where` rather than in an `if`.
 *
 * Only on failure does this read, and by then there is nothing left to race: the
 * attempt has already been counted.
 */
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

  /**
   * Count the guess before working out what kind of wrong it was.
   *
   * If classification came first, a caller who kept guessing while the row was
   * being read could get free attempts. Charging first means the cap holds even
   * under concurrency.
   */
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
    // No live code for this address at all: never requested, or already spent.
    return "unknown";
  }

  if (row.attempts > MAX_ATTEMPTS) {
    return "exhausted";
  }

  return row.expiresAt <= now ? "expired" : "invalid";
}
