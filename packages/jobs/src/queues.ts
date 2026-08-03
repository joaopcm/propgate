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
 * `noeviction` with no `maxmemory` — deliberately, because a cap we have not
 * measured is a tripwire in the wrong place — so "forever" means the box's
 * memory is the only limit, and a sweeper ticking every 60 seconds against ten
 * thousand domains reaches it. `noeviction` then makes writes fail rather than
 * silently dropping jobs, which is the right failure but still an outage.
 *
 * These two numbers are the bound. Neither is measured yet; both are sized as
 * tripwires past where anything useful lives:
 *
 * - **Completed, 1 hour / 1000 jobs.** A completed check is only interesting
 *   while someone is watching it happen in Workbench. After that the answer is
 *   in `domains.last_result`, which is the actual record.
 * - **Failed, 24 hours.** Failures are what you investigate, and you investigate
 *   them the next morning. The `webhook_deliveries` ledger keeps the durable
 *   record of anything that mattered, so this is a debugging convenience and not
 *   the source of truth.
 *
 * The receipt these are waiting on: observed Redis RSS with a full day of real
 * sweep traffic, measured in Phase 6. If a good widget ever hits either, the
 * number is wrong.
 */
const RETENTION: DefaultJobOptions = {
  removeOnComplete: { age: 3600, count: 1000 },
  removeOnFail: { age: 86_400 },
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

/**
 * Every queue, in one call.
 *
 * Workbench takes a list, and a queue missing from that list is invisible in the
 * dashboard while still accumulating jobs — the one place where forgetting to
 * add something produces a confidently wrong answer rather than an error.
 */
export function allQueues(options: QueueFactoryOptions): Queue[] {
  return [
    sweepQueue(options),
    checkDomainQueue(options),
    deliverWebhookQueue(options),
  ] as Queue[];
}
