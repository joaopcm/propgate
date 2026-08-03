import { Queue } from "bullmq";
import { testRedisUrl } from "./redis";

/**
 * A backstop, not the primary path.
 *
 * The probe below is configured not to retry, so an absent Redis rejects in
 * milliseconds. This only fires if a connection opens and then stalls before
 * BullMQ's version check completes — a hang rather than a refusal.
 */
const READINESS_TIMEOUT_MS = 5000;

/**
 * Fails loudly when Redis is missing, and says what fixes it.
 *
 * The same rule the DNS tier and Postgres follow: gate on an environment
 * variable rather than on reachability, because a suite that skips when the
 * server is down looks exactly like a suite that passed.
 *
 * The probe is a BullMQ `Queue` rather than a raw `ioredis` client on purpose.
 * It checks the thing the specs actually use — including the version check
 * BullMQ performs on connect, which is where an unsupported Redis would
 * otherwise surface as a confusing error inside the first spec. It also means
 * this package needs no `ioredis` dependency of its own.
 *
 * `retryStrategy: () => null` is what makes the failure readable. BullMQ sets
 * `maxRetriesPerRequest: null` on connections it owns, so the default behaviour
 * against an absent Redis is to reconnect forever: ten ECONNREFUSED traces over
 * five seconds, with the one line that says what to run buried at the bottom.
 * The same reasoning TESTING.md gives for preferring REFUSED-based DNS fixtures
 * over blackholes — fail immediately and say why.
 *
 * Production must never do this. There, reconnecting forever is correct.
 */
export default async function setup(): Promise<void> {
  const url = testRedisUrl();
  const queue = new Queue("readiness", {
    connection: { retryStrategy: () => null, url },
    prefix: "propgate-readiness",
  });

  // Without a listener, ioredis' connection error reaches the process as an
  // unhandled 'error' event and replaces the message below with a stack trace.
  queue.on("error", () => undefined);

  let timer: NodeJS.Timeout | undefined;

  try {
    await Promise.race([
      queue.waitUntilReady(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("timed out")),
          READINESS_TIMEOUT_MS
        );
      }),
    ]);
  } catch (cause) {
    throw new Error(`Redis unreachable at ${url} — run \`pnpm redis:up\``, {
      cause,
    });
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }

    // Best effort: on the failure path the client never connected, and a
    // rejection here would replace the actionable message with a socket error.
    await queue.close().catch(() => undefined);
  }
}
