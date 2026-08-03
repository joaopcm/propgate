import type { Database } from "@propgate/db";
import {
  createDb,
  createProfileVersion,
  domainById,
  registerDomain,
  tenants,
  truncateAll,
} from "@propgate/db";
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
async function dueDomain(nextCheckAt: Date) {
  const [tenant] = await db
    .insert(tenants)
    .values({ name: "partner" })
    .returning();
  const tenantId = String(tenant?.id);

  const profile = await createProfileVersion(db, {
    definition: {
      requirements: [{ check: "spf", include: "one.spf.test", key: "spf" }],
    },
    key: "sending",
    tenantId,
  });

  const outcome = await registerDomain(db, {
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

const PAST = new Date(Date.now() - 60_000);

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
            { db, settings: { resolver: RESOLVER } },
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

    await checkClaimedDomain({ db, settings: { resolver: RESOLVER } }, payload);

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
      { db, settings: { resolver: RESOLVER } },
      { domainId, tenantId }
    );

    expect(outcome.kind).toBe("gone");
  });
});
