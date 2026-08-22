import type { Queue } from "bullmq";
import { Worker } from "bullmq";
import { afterEach, describe, expect, it } from "vitest";
import { connectionFor } from "./connection";
import type { CheckDomainPayload } from "./payloads";
import { checkDomainQueue, QUEUE_NAMES } from "./queues";
import { testPrefix, testRedisUrl } from "./test/redis";

const URL = testRedisUrl();

const workers: Worker<CheckDomainPayload>[] = [];
const queues: Queue[] = [];

afterEach(async () => {
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

  it("bounds retention by count on every job it enqueues", async () => {
    const queue = queueWith(testPrefix("retention"));

    const job = await queue.add("check", {
      domainId: "d-1",
      tenantId: "t-1",
    });

    expect(job.opts.removeOnComplete).toMatchObject({
      count: expect.any(Number),
    });
    expect(job.opts.removeOnFail).toMatchObject({ count: expect.any(Number) });
  });

  it("really discards completed jobs past the count, rather than only recording the intent", async () => {
    const prefix = testPrefix("trim");
    const queue = queueWith(prefix);
    const total = 5;
    const keep = 2;

    const drained = new Promise<void>((resolve) => {
      let completed = 0;

      const worker = new Worker<CheckDomainPayload>(
        QUEUE_NAMES.checkDomain,
        () => Promise.resolve(),
        { concurrency: 1, connection: connectionFor(URL), prefix }
      );

      worker.on("completed", () => {
        completed += 1;

        if (completed === total) {
          resolve();
        }
      });

      workers.push(worker);
    });

    await queue.addBulk(
      Array.from({ length: total }, (_unused, index) => ({
        data: { domainId: `d-${index}`, tenantId: "t-1" },
        name: "check",
        opts: { removeOnComplete: { count: keep } },
      }))
    );

    await drained;

    expect(await queue.getCompletedCount()).toBe(keep);
  });

  it("cannot see jobs enqueued under a different prefix", async () => {
    const mine = queueWith(testPrefix("isolated-a"));
    const theirs = queueWith(testPrefix("isolated-b"));

    await mine.add("check", { domainId: "d-1", tenantId: "t-1" });

    expect(await mine.getWaitingCount()).toBe(1);
    expect(await theirs.getWaitingCount()).toBe(0);
  });
});
