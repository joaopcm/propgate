import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Database } from "../client";
import { createDb } from "../client";
import { domains } from "../schema/domains";
import { tenants } from "../schema/tenants";
import { truncateAll } from "../test/truncate";
import { createProfileVersion } from "./profiles";
import { domainTransitions, recordTransition } from "./state-transitions";

/**
 * The audit trail the thresholds depend on.
 *
 * `DEGRADED_AFTER_FAILURES` and `FAILED_AFTER_FAILURES` are unmeasured guesses.
 * The first false alarm is how they stop being guesses — and only if the evidence
 * that fired it is still readable afterwards, which `last_result` cannot promise
 * because the next check overwrites it.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

beforeEach(async () => {
  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

async function domain(): Promise<string> {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: "partner" })
    .returning();
  const tenantId = String(tenant?.id);
  const profile = await createProfileVersion(db, {
    definition: { requirements: [] },
    key: "sending",
    tenantId,
  });
  const [row] = await db
    .insert(domains)
    .values({
      name: "example.test",
      profileVersionId: profile.id,
      tenantId,
    })
    .returning({ id: domains.id });

  return String(row?.id);
}

describe("recordTransition", () => {
  it("keeps the states, the reason and the evidence", async () => {
    const domainId = await domain();

    const stored = await recordTransition(db, {
      domainId,
      evidence: {
        codes: ["DKIM_RECORD_MISSING"],
        consecutiveFailures: 3,
        vantages: [
          { server: "127.0.0.6:53", verdict: "fail" },
          { server: "1.1.1.1:53", verdict: "fail" },
        ],
        verdict: "fail",
      },
      fromState: "degraded",
      reason: "3 consecutive failures, reaching the failed threshold",
      toState: "failed",
    });

    expect(stored.fromState).toBe("degraded");
    expect(stored.toState).toBe("failed");
    // The per-vantage verdicts are the whole point: "did every vantage point
    // agree when you paged me" is the first question a false alarm raises.
    expect(stored.evidence?.vantages).toHaveLength(2);
    expect(stored.evidence?.consecutiveFailures).toBe(3);
  });

  it("returns a domain's transitions newest first", async () => {
    // Newest first, unlike listDomains: nobody reconciles this, they read it to
    // answer "what just happened".
    const domainId = await domain();

    await recordTransition(db, {
      domainId,
      evidence: { consecutiveFailures: 1, verdict: "fail" },
      fromState: "pending",
      reason: "first",
      toState: "degraded",
    });
    await recordTransition(db, {
      domainId,
      evidence: { consecutiveFailures: 3, verdict: "fail" },
      fromState: "degraded",
      reason: "second",
      toState: "failed",
    });

    const history = await domainTransitions(db, domainId);

    expect(history.map((entry) => entry.reason)).toEqual(["second", "first"]);
  });

  it("goes away with the domain", async () => {
    // Cascades, unlike profile_version_id. A transition for a domain that no
    // longer exists is not a record anyone can act on, and truncateAll depends on
    // reaching this table through tenants.
    const domainId = await domain();

    await recordTransition(db, {
      domainId,
      evidence: { consecutiveFailures: 1, verdict: "fail" },
      fromState: "pending",
      reason: "only",
      toState: "degraded",
    });

    await db.delete(domains);

    expect(await domainTransitions(db, domainId)).toEqual([]);
  });
});
