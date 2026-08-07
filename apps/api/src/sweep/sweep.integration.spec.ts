import type {
  Database,
  DomainExpectations,
  ProfileDefinition,
} from "@propgate/db";
import {
  createDb,
  createProfileVersion,
  domainById,
  domainTimeline,
  domainTransitions,
  registerDomain,
  tenants,
  truncateAll,
  updateDomainConfig,
} from "@propgate/db";
import {
  parseDkimRecord,
  query,
  RecordType,
  recordsOfType,
} from "@propgate/dns";
import { fixtureTarget } from "@propgate/dns-fixtures";
import type { CheckDomainPayload } from "@propgate/jobs";
import {
  checkDomainQueue,
  connectionFor,
  QUEUE_NAMES,
  testPrefix,
  testRedisUrl,
} from "@propgate/jobs";
import type { Queue } from "bullmq";
import { Worker } from "bullmq";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { checkClaimedDomain } from "./check-domain";
import { runReconcile, runTick } from "./tick";

/**
 * The sweeper end to end: Postgres decides, Redis carries, DNS answers.
 *
 * The one spec in the repo that needs all three tiers, and the only place the
 * central claim of this design is actually tested — that a domain gets checked
 * because time passed, with nobody calling an endpoint.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 6,
});

const REDIS = testRedisUrl();
const fixture = fixtureTarget("resolver");
const RESOLVER = { address: fixture.address, port: fixture.port };

const queues: Queue<CheckDomainPayload>[] = [];
const workers: Worker<CheckDomainPayload>[] = [];

afterEach(async () => {
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
  await Promise.all(queues.map((queue) => queue.close()));

  workers.length = 0;
  queues.length = 0;

  await truncateAll(db);
});

afterAll(async () => {
  await db.$client.end();
});

function queueWith(prefix: string): Queue<CheckDomainPayload> {
  const queue = checkDomainQueue({ prefix, url: REDIS });

  queues.push(queue);

  return queue;
}

/**
 * A domain that is due, pointed at a fixture zone.
 *
 * `customer.test` is the clean fixture — it satisfies an SPF include and a DKIM
 * selector — so a passing sweep is the expected outcome and any finding is a real
 * failure rather than a property of the zone.
 */
async function dueDomain(
  nextCheckAt: Date,
  options: {
    readonly definition?: ProfileDefinition;
    readonly expectations?: DomainExpectations;
  } = {}
) {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: "partner" })
    .returning();
  const tenantId = String(tenant?.id);

  const profile = await createProfileVersion(db, {
    definition: options.definition ?? {
      requirements: [{ check: "spf", include: "one.spf.test", key: "spf" }],
    },
    key: "sending",
    tenantId,
  });

  const outcome = await registerDomain(db, {
    ...(options.expectations === undefined
      ? {}
      : { expectations: options.expectations }),
    name: "customer.test",
    profileVersionId: profile.id,
    tenantId,
  });

  if (outcome.kind !== "created") {
    throw new Error(`expected a fresh domain, got ${outcome.kind}`);
  }

  await db.execute(
    // Registration sets `next_check_at` to now via the column default; making it
    // due in the past is what a tick would find on a real box.
    `update domains set next_check_at = '${nextCheckAt.toISOString()}' where id = '${outcome.domain.id}'`
  );

  return { domainId: outcome.domain.id, tenantId };
}

/** A profile whose DKIM key is issued per domain, against the fixture selector. */
const DEFERS_KEY: ProfileDefinition = {
  requirements: [
    {
      check: "dkim",
      key: "dkim",
      requiredPerDomain: ["expectedPublicKey"],
      selector: "pg1",
    },
  ],
};

/**
 * The key `customer.test` really publishes, read from the zone at run time.
 *
 * Discovered rather than pasted in: a hardcoded copy goes stale the next time the
 * fixtures are re-signed, and the test that would then fail is the one asserting
 * a match — so it would read as the sweeper breaking rather than the constant.
 */
async function publishedKey(): Promise<string> {
  const outcome = await query({
    name: "pg1._domainkey.customer.test",
    recursionDesired: true,
    target: RESOLVER,
    timeoutMs: 2000,
    type: RecordType.TXT,
  });

  if (outcome.status !== "answered") {
    throw new Error(`fixture lookup was ${outcome.status}`);
  }

  const [record] = recordsOfType(outcome.message.answers, "TXT");
  const parsed = parseDkimRecord(record?.rdata.value ?? "");

  if (!parsed.ok) {
    throw new Error(`fixture DKIM record did not parse: ${parsed.detail}`);
  }

  return parsed.record.publicKeyBase64;
}

/** Claim, dequeue and check exactly as a worker would. */
async function sweepOnce(prefix: string) {
  const queue = queueWith(prefix);

  await runTick({ batchSize: 10, db, leaseSeconds: 300, queue });

  const [job] = await queue.getJobs(["waiting"]);
  const payload = job?.data;

  if (payload === undefined) {
    throw new Error("the tick enqueued nothing");
  }

  return await checkClaimedDomain(
    { db, settings: { resolvers: [RESOLVER] } },
    payload
  );
}

const PAST = new Date(Date.now() - 60_000);

/** A full SHA-256, which is what `compileProfile` produces. */
const FINGERPRINT = /^[0-9a-f]{64}$/;

describe("the sweep loop", () => {
  it("checks a domain because it was due, and reschedules it", async () => {
    const prefix = testPrefix("sweep-loop");
    const queue = queueWith(prefix);
    const { domainId, tenantId } = await dueDomain(PAST);

    const claimed = await runTick({
      batchSize: 10,
      db,
      leaseSeconds: 300,
      queue,
    });

    expect(claimed).toBe(1);

    const done = new Promise<void>((resolve) => {
      const worker = new Worker<CheckDomainPayload>(
        QUEUE_NAMES.checkDomain,
        async (job) => {
          await checkClaimedDomain(
            { db, settings: { resolvers: [RESOLVER] } },
            job.data
          );
        },
        { concurrency: 1, connection: connectionFor(REDIS), prefix }
      );

      worker.on("completed", () => resolve());
      workers.push(worker);
    });

    await done;

    const after = await domainById(db, tenantId, domainId);

    // The three things a sweep is for: it looked, it wrote down what it saw, and
    // it decided when to look again.
    expect(after?.lastCheckedAt).not.toBeNull();
    expect(after?.lastResult?.verdict).toBe("pass");
    expect(after?.state).toBe("verified");

    // Rescheduled a day out rather than left on the lease. A domain that keeps
    // its lease deadline gets re-checked in five minutes forever.
    const nextCheck = after?.nextCheckAt?.getTime() ?? 0;

    expect(nextCheck - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
  });

  it("stores the lookups that produced the verdict", async () => {
    // Derivation over verdict. A stored `pass` that cannot say which queries
    // produced it is the thing every other checker already gives you.
    const prefix = testPrefix("sweep-lookups");
    const queue = queueWith(prefix);
    const { domainId, tenantId } = await dueDomain(PAST);

    await runTick({ batchSize: 10, db, leaseSeconds: 300, queue });

    const job = await queue.getJobs(["waiting"]);
    const payload = job[0]?.data;

    if (payload === undefined) {
      throw new Error("the tick enqueued nothing");
    }

    await checkClaimedDomain(
      { db, settings: { resolvers: [RESOLVER] } },
      payload
    );

    const after = await domainById(db, tenantId, domainId);

    expect((after?.lastResult?.lookups ?? []).length).toBeGreaterThan(0);
  });

  it("re-enqueues work after Redis loses it", async () => {
    // The reason nothing in this design is afraid of a flushed Redis. The rows
    // stay due in Postgres, so recovery is a tick rather than an intervention.
    const prefix = testPrefix("sweep-amnesia");
    const queue = queueWith(prefix);

    await dueDomain(PAST);
    await runTick({ batchSize: 10, db, leaseSeconds: 300, queue });

    expect(await queue.getWaitingCount()).toBe(1);

    await queue.obliterate({ force: true });

    expect(await queue.getWaitingCount()).toBe(0);

    // Still holding its lease, so an immediate reconcile correctly finds nothing:
    // the row is not due, and re-checking it now would be the double-check the
    // lease exists to prevent.
    expect(
      await runReconcile({ batchSize: 10, db, leaseSeconds: 300, queue })
    ).toBe(0);

    // Once the lease lapses the work comes back on its own.
    await db.execute(
      "update domains set next_check_at = now() - interval '1 second'"
    );

    expect(
      await runReconcile({ batchSize: 10, db, leaseSeconds: 300, queue })
    ).toBe(1);
    expect(await queue.getWaitingCount()).toBe(1);
  });

  it("treats a domain deleted mid-flight as nothing to do", async () => {
    // A customer removing a domain between the claim and the check must not
    // produce a failed job that retries three times against a row that is gone.
    const { domainId, tenantId } = await dueDomain(PAST);

    await db.execute(`delete from domains where id = '${domainId}'`);

    const outcome = await checkClaimedDomain(
      { db, settings: { resolvers: [RESOLVER] } },
      { domainId, tenantId }
    );

    expect(outcome.kind).toBe("gone");
  });
});

describe("the sweeper and per-domain expectations", () => {
  /**
   * The test the whole mechanism exists for.
   *
   * The sweeper reads a domain through `domainById` and nothing else, so a
   * missing column, a missing spread, or an optional argument anywhere between the
   * row and the evaluator produces a sweeper that compares against nothing — and
   * because an absent expectation used to mean "any valid key is fine", it would
   * report `pass` while doing so. No route spec can reach this path.
   */
  it("compares the domain's own key and passes when it matches", async () => {
    const key = await publishedKey();
    const { domainId, tenantId } = await dueDomain(PAST, {
      definition: DEFERS_KEY,
      expectations: { dkim: { expectedPublicKey: key } },
    });

    await sweepOnce(testPrefix("sweep-key-match"));

    const after = await domainById(db, tenantId, domainId);

    expect(after?.lastResult?.verdict).toBe("pass");
    expect(after?.state).toBe("verified");
    // The digest proves which values the verdict was produced against.
    expect(after?.lastResult?.expectationsFingerprint).toMatch(FINGERPRINT);
  });

  it("fails with a mismatch when the wrong key is expected", async () => {
    // Same zone, same profile, different value. `customer.test` publishes a
    // perfectly valid key here, so this fails only because the comparison ran.
    const { domainId, tenantId } = await dueDomain(PAST, {
      definition: DEFERS_KEY,
      expectations: {
        dkim: {
          expectedPublicKey: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8ANOTTHEKEY",
        },
      },
    });

    await sweepOnce(testPrefix("sweep-key-wrong"));

    const after = await domainById(db, tenantId, domainId);

    expect(after?.lastResult?.verdict).toBe("fail");
    expect(
      after?.lastResult?.requirements[0]?.findings.map((entry) => entry.code)
    ).toContain("DKIM_KEY_MISMATCH");
  });

  it("leaves a domain alone when a required value was never supplied", async () => {
    /**
     * Five assertions, because each is a separate way for "we cannot judge this"
     * to become either a false verdict or a domain that quietly stopped being
     * monitored — and the last one is the worst failure this product has.
     */
    const { domainId, tenantId } = await dueDomain(PAST, {
      definition: DEFERS_KEY,
    });
    const before = await domainById(db, tenantId, domainId);

    await sweepOnce(testPrefix("sweep-incomplete"));

    const after = await domainById(db, tenantId, domainId);

    expect(after?.lastResult?.verdict).toBe("indeterminate");
    expect(after?.state).toBe(before?.state);
    expect(after?.consecutiveFailures).toBe(before?.consecutiveFailures);
    expect(await domainTimeline(db, domainId, 10)).toEqual([]);
    expect(await domainTransitions(db, domainId)).toEqual([]);
    // Still monitored. A domain that drops out of the sweep is unrecoverable
    // without someone noticing it is missing.
    expect((after?.nextCheckAt?.getTime() ?? 0) > Date.now()).toBe(true);
  });

  it("names the value it is waiting for", async () => {
    // An agent can act on a JSON path. It cannot act on `indeterminate`.
    const { domainId, tenantId } = await dueDomain(PAST, {
      definition: DEFERS_KEY,
    });

    await sweepOnce(testPrefix("sweep-incomplete-named"));

    const after = await domainById(db, tenantId, domainId);

    expect(after?.lastResult?.requirements[0]?.findings).toEqual([
      {
        code: "EXPECTATION_MISSING",
        expected: "expectations.dkim.expectedPublicKey",
      },
    ]);
  });

  it("sends no DNS at all when it cannot judge the domain", async () => {
    // The reason the incomplete branch skips the resolver rather than running the
    // requirements that are complete: an incomplete domain never fixes itself, so
    // any queries spent here are spent on every sweep forever.
    const { domainId, tenantId } = await dueDomain(PAST, {
      definition: DEFERS_KEY,
    });

    await sweepOnce(testPrefix("sweep-no-dns"));

    const after = await domainById(db, tenantId, domainId);

    expect(after?.lastResult?.lookups).toEqual([]);
  });

  it("re-verifies without a false failure after a key is rotated", async () => {
    /**
     * The fleet-rotation case, which is why a config write resets to `pending`.
     *
     * Without the reset this domain goes `verified → degraded` on the very first
     * check — `degradedAfter` is 1 — and fires `domain.degraded` claiming the
     * customer's DNS broke. Across ten thousand domains that is ten thousand false
     * pages inside one sweep interval, with no zone change behind any of them.
     */
    const key = await publishedKey();
    const { domainId, tenantId } = await dueDomain(PAST, {
      definition: DEFERS_KEY,
      expectations: { dkim: { expectedPublicKey: key } },
    });

    await sweepOnce(testPrefix("sweep-rotate-first"));

    expect((await domainById(db, tenantId, domainId))?.state).toBe("verified");

    await updateDomainConfig(db, tenantId, domainId, {
      expectations: {
        dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0NOTYET" },
      },
    });

    const reset = await domainById(db, tenantId, domainId);

    expect(reset?.state).toBe("pending");
    expect(reset?.consecutiveFailures).toBe(0);

    await db.execute(
      `update domains set next_check_at = now() - interval '1 second' where id = '${domainId}'`
    );
    await sweepOnce(testPrefix("sweep-rotate-second"));

    const after = await domainById(db, tenantId, domainId);

    // One definite failure against the new key, so it is only `degraded` if the
    // reset never happened. From `pending` the same failure cannot skip a step.
    expect(after?.lastResult?.verdict).toBe("fail");
    expect(after?.state).not.toBe("degraded");
    expect(
      (await domainTransitions(db, domainId)).map((entry) => entry.toState)
    ).not.toContain("degraded");
  });

  it("does not claim the customer's zone changed when we changed", async () => {
    /**
     * The timeline is the surface built to deflect support tickets, and its whole
     * value is that "the DKIM record changed Tuesday at 14:02" is about the
     * customer. A rotation must not write that sentence about us.
     */
    const key = await publishedKey();
    const { domainId, tenantId } = await dueDomain(PAST, {
      definition: DEFERS_KEY,
      expectations: { dkim: { expectedPublicKey: key } },
    });

    await sweepOnce(testPrefix("sweep-timeline-first"));

    const first = await domainTimeline(db, domainId, 10);

    expect(first).toHaveLength(1);

    await updateDomainConfig(db, tenantId, domainId, {
      expectations: {
        dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0NOTYET" },
      },
    });
    await db.execute(
      `update domains set next_check_at = now() - interval '1 second' where id = '${domainId}'`
    );
    await sweepOnce(testPrefix("sweep-timeline-second"));

    // Still one entry: the first observation. Nothing appended for the check whose
    // only change was the value we asked it to compare.
    expect(await domainTimeline(db, domainId, 10)).toHaveLength(1);
  });

  it("moves the fingerprint when the profile is re-pointed", async () => {
    // A re-point changes what the domain is judged against with nothing written to
    // its values, which is exactly what a digest over the *merged* set catches and
    // a timestamp on the row would not.
    const { domainId, tenantId } = await dueDomain(PAST);

    await sweepOnce(testPrefix("sweep-repoint-first"));

    const before = (await domainById(db, tenantId, domainId))?.lastResult
      ?.expectationsFingerprint;

    const moved = await createProfileVersion(db, {
      definition: {
        requirements: [{ check: "spf", include: "two.spf.test", key: "spf" }],
      },
      key: "sending",
      tenantId,
    });

    await updateDomainConfig(db, tenantId, domainId, {
      profileVersionId: moved.id,
    });
    await db.execute(
      `update domains set next_check_at = now() - interval '1 second' where id = '${domainId}'`
    );
    await sweepOnce(testPrefix("sweep-repoint-second"));

    const after = (await domainById(db, tenantId, domainId))?.lastResult
      ?.expectationsFingerprint;

    expect(before).toBeTypeOf("string");
    expect(after).not.toBe(before);
  });
});
