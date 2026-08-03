import type { Queue } from "bullmq";
import { Worker } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";
import { connectionFor } from "./connection";
import type { CheckDomainPayload } from "./payloads";
import { checkDomainQueue, QUEUE_NAMES } from "./queues";
import { testPrefix, testRedisUrl } from "./test/redis";

/**
 * The queue path, against a real Redis.
 *
 * Never a mocked one, for the same reason DNS is never mocked: a stub agrees
 * with whatever you believed when you wrote it, and everything worth knowing
 * here — that BullMQ's version check passes, that a prefix really isolates,
 * that retention lands on the job rather than being silently dropped — is a
 * property of the server rather than of our code.
 */

const URL = testRedisUrl();

const workers: Worker<CheckDomainPayload>[] = [];
const queues: Queue[] = [];

afterEach(async () => {
  // Workers first: obliterating a queue a worker is still blocked on leaves the
  // worker reconnecting to keys that no longer exist.
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all(queues.map((queue) => queue.obliterate({ force: true })));
  await Promise.all(queues.map((queue) => queue.close()));

  workers.length = 0;
  queues.length = 0;
});

function queueWith(prefix: string): Queue<CheckDomainPayload> {
  const queue = checkDomainQueue({ prefix, url: URL });

  queues.push(queue as Queue);

  return queue;
}

describe("checkDomainQueue", () => {
  it("delivers a payload to a worker on the same queue", async () => {
    const prefix = testPrefix("roundtrip");
    const queue = queueWith(prefix);

    const delivered = new Promise<CheckDomainPayload>((resolve) => {
      const worker = new Worker<CheckDomainPayload>(
        QUEUE_NAMES.checkDomain,
        (job) => {
          resolve(job.data);

          return Promise.resolve();
        },
        { connection: connectionFor(URL), prefix }
      );

      workers.push(worker);
    });

    await queue.add("check", { domainId: "d-1", tenantId: "t-1" });

    expect(await delivered).toEqual({ domainId: "d-1", tenantId: "t-1" });
  });

  it("puts retention on every job it enqueues", async () => {
    // The landmine this guards is forgetting the default, not choosing the wrong
    // number. BullMQ keeps completed jobs forever unless told otherwise, and our
    // Redis runs `noeviction` with no `maxmemory` — so an unbounded completed
    // set is the box's memory, reached quietly and then all at once.
    const queue = queueWith(testPrefix("retention"));

    const job = await queue.add("check", {
      domainId: "d-1",
      tenantId: "t-1",
    });

    expect(job.opts.removeOnComplete).toBeDefined();
    expect(job.opts.removeOnFail).toBeDefined();
  });

  it("cannot see jobs enqueued under a different prefix", async () => {
    // This is the spec that earns `fileParallelism: true` for this project. If
    // prefixes did not isolate, every Redis-backed spec would have to be
    // serialised the way the Postgres ones are.
    const mine = queueWith(testPrefix("isolated-a"));
    const theirs = queueWith(testPrefix("isolated-b"));

    await mine.add("check", { domainId: "d-1", tenantId: "t-1" });

    expect(await mine.getWaitingCount()).toBe(1);
    expect(await theirs.getWaitingCount()).toBe(0);
  });
});
