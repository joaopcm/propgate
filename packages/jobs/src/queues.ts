import type { DefaultJobOptions, QueueOptions } from "bullmq";
import { Queue } from "bullmq";
import { connectionFor } from "./connection";
import type {
  CheckDomainPayload,
  DeliverWebhookPayload,
  SweepTickPayload,
} from "./payloads";

export const QUEUE_NAMES = {
  checkDomain: "check-domain",
  deliverWebhook: "deliver-webhook",
  sweep: "sweep",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

const RETENTION: DefaultJobOptions = {
  removeOnComplete: { age: 604_800, count: 25_000 },
  removeOnFail: { age: 1_209_600, count: 5000 },
};

export interface QueueFactoryOptions {
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

export function createQueues(options: QueueFactoryOptions): Queues {
  return {
    checkDomain: checkDomainQueue(options),
    deliverWebhook: deliverWebhookQueue(options),
    sweep: sweepQueue(options),
  };
}

export function queueList(queues: Queues): Queue[] {
  return Object.values(queues) as Queue[];
}
