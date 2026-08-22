import type { ConnectionOptions } from "bullmq";

export function connectionFor(url: string): ConnectionOptions {
  return { url };
}
