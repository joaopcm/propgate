import { Queue } from "bullmq";
import { testRedisUrl } from "./redis";

const READINESS_TIMEOUT_MS = 5000;

export default async function setup(): Promise<void> {
  const url = testRedisUrl();
  const queue = new Queue("readiness", {
    connection: { retryStrategy: () => null, url },
    prefix: "propgate-readiness",
  });

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

    await queue.close().catch(() => undefined);
  }
}
