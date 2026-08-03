import type { DefaultJobOptions, QueueOptions } from "bullmq";
import { Queue } from "bullmq";
import { connectionFor } from "./connection";
import type {
  CheckDomainPayload,
  DeliverWebhookPayload,
  SweepTickPayload,
} from "./payloads";

/**
 * Three queues, named once.
 *
 * The producer lives in the API and the consumer lives in the worker, so a
 * queue name is a wire contract between two processes. A typo in one of them
 * produces a job nobody ever runs and no error at all — which is why these are
 * constants in a package both sides import rather than strings at each call
 * site.
 */
export const QUEUE_NAMES = {
  checkDomain: "check-domain",
  deliverWebhook: "deliver-webhook",
  sweep: "sweep",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

/**
 * Retention, and it is load-bearing rather than tidiness.
 *
 * BullMQ keeps completed and failed jobs forever by default. Our Redis runs
 * `noeviction` with no `maxmemory` — deliberately, because a cap nobody has
 * measured is a tripwire in the wrong place — so "forever" means the box's
 * memory is the only limit. `noeviction` then makes writes fail rather than
 * silently dropping jobs, which is the right failure but still an outage. These
 * numbers are what stands in the way, so the two decisions are coupled: change
 * one and revisit the other.
 *
 * **The receipt.** Measured against Redis 8 with a real `{ domainId, tenantId }`
 * payload, 3000 jobs per run, `used_memory` before and after:
 *
 * | State | Bytes per job |
 * |---|---|
 * | waiting | ~575 |
 * | completed | ~1,000 |
 * | failed | ~2,560 |
 *
 * Failed jobs cost 2.5x because they carry `failedReason` and a stack trace.
 *
 * **The numbers.** `age` bounds how far back Workbench can look; `count` is the
 * hard memory bound, which is the one that matters. Both are tripwires sized
 * well past where anything useful lives, so a healthy queue never feels them:
 *
 * - **Completed: 25,000 jobs, 7 days.** ~25 MB per queue at the rate above.
 *   25,000 checks is about 2.5 days of history at ten thousand monitored domains
 *   and months of it at current scale. Past that the answer lives in
 *   `domains.last_result`, which is the actual record — this is only the window
 *   where watching it happen is still useful.
 * - **Failed: 5,000 jobs, 14 days.** ~13 MB per queue. Longer in days because
 *   failures are what you investigate and you investigate them next week;
 *   shorter in count because more than five thousand unresolved failures is a
 *   systemic problem rather than a debugging need. The `webhook_deliveries`
 *   ledger is the durable record, so nothing is lost when this bites.
 *
 * Worst case across all three queues with every set saturated at once: ~115 MB.
 * That cannot happen in practice — `sweep` takes 1440 jobs a day and
 * `deliver-webhook` far fewer — but it is a real ceiling rather than a hope.
 */
const RETENTION: DefaultJobOptions = {
  removeOnComplete: { age: 604_800, count: 25_000 },
  removeOnFail: { age: 1_209_600, count: 5000 },
};

export interface QueueFactoryOptions {
  /**
   * BullMQ key prefix. Defaults to BullMQ's own `bull`.
   *
   * Specs pass a unique one per file, which namespaces every key they touch and
   * is why `fileParallelism` stays on for the Redis project. See
   * `src/test/redis.ts`.
   */
  readonly prefix?: string;
  readonly url: string;
}

function queueOptions(options: QueueFactoryOptions): QueueOptions {
  return {
    connection: connectionFor(options.url),
    defaultJobOptions: RETENTION,
    ...(options.prefix === undefined ? {} : { prefix: options.prefix }),
  };
}

export function checkDomainQueue(
  options: QueueFactoryOptions
): Queue<CheckDomainPayload> {
  return new Queue<CheckDomainPayload>(
    QUEUE_NAMES.checkDomain,
    queueOptions(options)
  );
}

export function deliverWebhookQueue(
  options: QueueFactoryOptions
): Queue<DeliverWebhookPayload> {
  return new Queue<DeliverWebhookPayload>(
    QUEUE_NAMES.deliverWebhook,
    queueOptions(options)
  );
}

export function sweepQueue(
  options: QueueFactoryOptions
): Queue<SweepTickPayload> {
  return new Queue<SweepTickPayload>(QUEUE_NAMES.sweep, queueOptions(options));
}

export interface Queues {
  readonly checkDomain: Queue<CheckDomainPayload>;
  readonly deliverWebhook: Queue<DeliverWebhookPayload>;
  readonly sweep: Queue<SweepTickPayload>;
}

/**
 * Every queue, constructed once.
 *
 * Named rather than an array because the worker needs to reach two of them
 * specifically, and constructing them a second time to get a typed handle would
 * double the Redis connections for nothing.
 */
export function createQueues(options: QueueFactoryOptions): Queues {
  return {
    checkDomain: checkDomainQueue(options),
    deliverWebhook: deliverWebhookQueue(options),
    sweep: sweepQueue(options),
  };
}

/**
 * The same queues as a list, for Workbench and for shutdown.
 *
 * Derived rather than hand-written at the call site: a queue missing from
 * Workbench's list is invisible in the dashboard while still accumulating jobs,
 * which is the one place where forgetting something produces a confidently wrong
 * answer rather than an error. Deriving it means adding a queue to `Queues` is
 * enough.
 */
export function queueList(queues: Queues): Queue[] {
  return Object.values(queues) as Queue[];
}
