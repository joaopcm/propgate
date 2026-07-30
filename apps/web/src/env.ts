import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
  client: {
    // The checker's DNS lookups run in the always-on resolver service, not in
    // Next route handlers — a polling workload is the worst possible fit for
    // per-invocation billing.
    NEXT_PUBLIC_API_URL: z.url().default("http://localhost:3001"),
  },
  emptyStringAsUndefined: true,
  experimental__runtimeEnv: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  },
});
