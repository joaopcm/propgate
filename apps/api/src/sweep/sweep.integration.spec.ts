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
import { checkAndPersist } from "../domains/check";
import { checkClaimedDomain } from "./check-domain";
import { runReconcile, runTick } from "./tick";

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
    `update domains set next_check_at = '${nextCheckAt.toISOString()}' where id = '${outcome.domain.id}'`
  );

  return { domainId: outcome.domain.id, tenantId };
}

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

    expect(after?.lastCheckedAt).not.toBeNull();
    expect(after?.lastResult?.verdict).toBe("pass");
    expect(after?.state).toBe("verified");

    const nextCheck = after?.nextCheckAt?.getTime() ?? 0;

    expect(nextCheck - Date.now()).toBeGreaterThan(23 * 3600 * 1000);
  });

  it("stores the lookups that produced the verdict", async () => {
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
    const prefix = testPrefix("sweep-amnesia");
    const queue = queueWith(prefix);

    await dueDomain(PAST);
    await runTick({ batchSize: 10, db, leaseSeconds: 300, queue });

    expect(await queue.getWaitingCount()).toBe(1);

    await queue.obliterate({ force: true });

    expect(await queue.getWaitingCount()).toBe(0);

    expect(
      await runReconcile({ batchSize: 10, db, leaseSeconds: 300, queue })
    ).toBe(0);

    await db.execute(
      "update domains set next_check_at = now() - interval '1 second'"
    );

    expect(
      await runReconcile({ batchSize: 10, db, leaseSeconds: 300, queue })
    ).toBe(1);
    expect(await queue.getWaitingCount()).toBe(1);
  });

  it("treats a domain deleted mid-flight as nothing to do", async () => {
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
    expect(after?.lastResult?.expectationsFingerprint).toMatch(FINGERPRINT);
  });

  it("fails with a mismatch when the wrong key is expected", async () => {
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
    expect((after?.nextCheckAt?.getTime() ?? 0) > Date.now()).toBe(true);
  });

  it("names the value it is waiting for", async () => {
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
    const { domainId, tenantId } = await dueDomain(PAST, {
      definition: DEFERS_KEY,
    });

    await sweepOnce(testPrefix("sweep-no-dns"));

    const after = await domainById(db, tenantId, domainId);

    expect(after?.lastResult?.lookups).toEqual([]);
  });

  it("re-verifies without a false failure after a key is rotated", async () => {
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

    await sweepOnce(testPrefix("sweep-rotate-second"));

    const after = await domainById(db, tenantId, domainId);

    expect(after?.lastResult?.verdict).toBe("fail");
    expect(after?.state).not.toBe("degraded");
    expect(
      (await domainTransitions(db, domainId)).map((entry) => entry.toState)
    ).not.toContain("degraded");
  });

  it("does not claim the customer's zone changed when we changed", async () => {
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
    await sweepOnce(testPrefix("sweep-timeline-second"));

    expect(await domainTimeline(db, domainId, 10)).toHaveLength(1);
  });

  it("discards a check whose configuration moved while it was running", async () => {
    const key = await publishedKey();
    const { domainId, tenantId } = await dueDomain(PAST, {
      definition: DEFERS_KEY,
      expectations: { dkim: { expectedPublicKey: key } },
    });
    const snapshot = await domainById(db, tenantId, domainId);

    if (snapshot === undefined) {
      throw new Error("the domain went missing");
    }

    await updateDomainConfig(db, tenantId, domainId, {
      expectations: {
        dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0ROTATED" },
      },
    });

    const checked = await checkAndPersist(db, {
      domain: { ...snapshot, tenantId },
      profile: { definition: DEFERS_KEY, id: snapshot.profileVersionId },
      settings: { resolvers: [RESOLVER] },
    });

    expect(checked).toBeNull();

    const after = await domainById(db, tenantId, domainId);

    expect(after?.state).toBe("pending");
    expect(after?.lastResult).toBeNull();
    expect(after?.lastCheckedAt).toBeNull();
    expect(await domainTransitions(db, domainId)).toEqual([]);
    expect(await domainTimeline(db, domainId, 10)).toEqual([]);
  });

  it("honours a rotation that lands between the claim and the check", async () => {
    const key = await publishedKey();
    const { domainId, tenantId } = await dueDomain(PAST, {
      definition: DEFERS_KEY,
      expectations: {
        dkim: { expectedPublicKey: "MIIBIjANBgkqhkiG9w0STALE" },
      },
    });
    const queue = queueWith(testPrefix("sweep-reread"));

    await runTick({ batchSize: 10, db, leaseSeconds: 300, queue });

    const [job] = await queue.getJobs(["waiting"]);
    const payload = job?.data;

    if (payload === undefined) {
      throw new Error("the tick enqueued nothing");
    }

    await updateDomainConfig(db, tenantId, domainId, {
      expectations: { dkim: { expectedPublicKey: key } },
    });

    const outcome = await checkClaimedDomain(
      { db, settings: { resolvers: [RESOLVER] } },
      payload
    );

    expect(outcome.kind).toBe("checked");
    expect(
      (await domainById(db, tenantId, domainId))?.lastResult?.verdict
    ).toBe("pass");
  });

  it("moves the fingerprint when the profile is re-pointed", async () => {
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
    await sweepOnce(testPrefix("sweep-repoint-second"));

    const after = (await domainById(db, tenantId, domainId))?.lastResult
      ?.expectationsFingerprint;

    expect(before).toBeTypeOf("string");
    expect(after).not.toBe(before);
  });
});
