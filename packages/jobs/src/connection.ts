import type { ConnectionOptions } from "bullmq";

/**
 * Connection **options**, never our own client instance.
 *
 * BullMQ requires `maxRetriesPerRequest: null` on any connection a `Worker`
 * blocks on, and when it owns the connection it sets that itself
 * (`redis-connection.js`). Hand it an `ioredis` instance we built and that
 * assignment never happens: the worker inherits ioredis' default of 20 retries,
 * and a blocking command that outlives them rejects. The symptom is a worker
 * that stops picking up jobs, with no error anywhere, some minutes after Redis
 * hiccups.
 *
 * So there is deliberately no exported way to pass a client in. If a shared
 * client is ever genuinely needed, the retry option comes with it.
 */
export function connectionFor(url: string): ConnectionOptions {
  return { url };
}
