import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client";
import { createDb } from "../client";
import { otpCodes } from "../schema/otp-codes";
import { truncateAll } from "../test/truncate";
import { consumeCode, issueCode, MAX_ATTEMPTS } from "./otp";

/**
 * The credential store, against a real Postgres.
 *
 * Two properties here cannot be checked any other way: that the partial unique
 * index really keeps one live code per address, and that two concurrent confirms
 * cannot both succeed. The second is the one that would mint two accounts.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 6,
});

const EMAIL = "someone@example.com";
const HASH = "hash-of-418302";
const OTHER = "hash-of-999999";
const NOW = new Date("2026-08-04T12:00:00.000Z");
const LATER = new Date("2026-08-04T12:20:00.000Z");

function expiry(from: Date, minutes = 10): Date {
  return new Date(from.getTime() + minutes * 60_000);
}

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

/**
 * Spend `times` wrong guesses, one after another.
 *
 * Sequential rather than `Promise.all`: each guess has to charge an attempt, and
 * concurrent updates would race the counter and under-count.
 */
async function guessWrong(times: number): Promise<void> {
  await Array.from({ length: times }).reduce<Promise<unknown>>(
    (chain) =>
      chain.then(() => consumeCode(db, { codeHash: OTHER, email: EMAIL }, NOW)),
    Promise.resolve()
  );
}

async function issue(now = NOW, hash = HASH) {
  return await issueCode(
    db,
    { codeHash: hash, email: EMAIL, expiresAt: expiry(now) },
    now
  );
}

describe("issueCode", () => {
  it("issues a code for a new address", async () => {
    expect(await issue()).toEqual({ kind: "issued" });
  });

  it("throttles a second request inside the cooldown", async () => {
    // One mail per double-clicked form, not two.
    await issue();

    expect(await issue(new Date(NOW.getTime() + 5000))).toMatchObject({
      kind: "throttled",
    });
  });

  it("replaces the live code once the cooldown lapses", async () => {
    // The plan said "re-send the same code", which is impossible with a hash-only
    // store — so a repeat request mints a new one instead. The property that
    // mattered survives: still exactly one live code.
    await issue();

    const again = await issue(new Date(NOW.getTime() + 61_000), OTHER);

    expect(again).toEqual({ kind: "issued" });

    const live = await db
      .select()
      .from(otpCodes)
      .where(eq(otpCodes.email, EMAIL));

    expect(live).toHaveLength(1);
    expect(live[0]?.codeHash).toBe(OTHER);
  });

  it("resets the attempt budget when it replaces a code", async () => {
    // Otherwise somebody could lock an address out of signing up by guessing at
    // it until the cap was spent.
    await issue();
    await consumeCode(db, { codeHash: OTHER, email: EMAIL }, NOW);

    await issue(new Date(NOW.getTime() + 61_000), OTHER);

    const [row] = await db
      .select()
      .from(otpCodes)
      .where(eq(otpCodes.email, EMAIL));

    expect(row?.attempts).toBe(0);
  });

  it("lets a new code be issued after one was consumed", async () => {
    // The index is partial, so consumed rows do not block a later signup — which
    // is what makes re-running the flow the account-recovery path.
    await issue();
    await consumeCode(db, { codeHash: HASH, email: EMAIL }, NOW);

    expect(await issue(LATER, OTHER)).toEqual({ kind: "issued" });
    expect(
      await db.select().from(otpCodes).where(eq(otpCodes.email, EMAIL))
    ).toHaveLength(2);
  });

  it("keeps two addresses independent", async () => {
    await issue();

    expect(
      await issueCode(
        db,
        {
          codeHash: HASH,
          email: "other@example.com",
          expiresAt: expiry(NOW),
        },
        NOW
      )
    ).toEqual({ kind: "issued" });
  });
});

describe("consumeCode", () => {
  it("accepts the right code once", async () => {
    await issue();

    expect(await consumeCode(db, { codeHash: HASH, email: EMAIL }, NOW)).toBe(
      "consumed"
    );
  });

  it("refuses the same code a second time", async () => {
    // Single use. The second confirm of a retried request must not mint another
    // key.
    await issue();
    await consumeCode(db, { codeHash: HASH, email: EMAIL }, NOW);

    expect(await consumeCode(db, { codeHash: HASH, email: EMAIL }, NOW)).toBe(
      "unknown"
    );
  });

  it("charges a wrong guess", async () => {
    await issue();

    expect(await consumeCode(db, { codeHash: OTHER, email: EMAIL }, NOW)).toBe(
      "invalid"
    );

    const [row] = await db
      .select()
      .from(otpCodes)
      .where(eq(otpCodes.email, EMAIL));

    expect(row?.attempts).toBe(1);
  });

  it("stops accepting anything past the attempt cap", async () => {
    // The reason six digits is safe. Without this, 10^6 is minutes of guessing.
    await issue();

    await guessWrong(MAX_ATTEMPTS);

    // Even the *correct* code is now dead, which is the point: a code somebody
    // has been grinding at is not one to trust.
    expect(await consumeCode(db, { codeHash: HASH, email: EMAIL }, NOW)).toBe(
      "exhausted"
    );
  });

  it("refuses an expired code", async () => {
    await issue();

    expect(await consumeCode(db, { codeHash: HASH, email: EMAIL }, LATER)).toBe(
      "expired"
    );
  });

  it("reports an address with no live code as unknown", async () => {
    expect(await consumeCode(db, { codeHash: HASH, email: EMAIL }, NOW)).toBe(
      "unknown"
    );
  });

  it("lets exactly one of two concurrent confirms win", async () => {
    // The property that would otherwise mint two accounts for one signup. Both
    // statements are issued before either is awaited, so they genuinely contend.
    await issue();

    const [first, second] = await Promise.all([
      consumeCode(db, { codeHash: HASH, email: EMAIL }, NOW),
      consumeCode(db, { codeHash: HASH, email: EMAIL }, NOW),
    ]);

    expect([first, second].filter((outcome) => outcome === "consumed")).toEqual(
      ["consumed"]
    );
  });
});
