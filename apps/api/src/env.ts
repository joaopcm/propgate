import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(3001),
    /**
     * The recursive resolver every check queries.
     *
     * Port is explicit and never assumed to be 53: the fixture tier serves real
     * port 53 on distinct loopback addresses, and a production deployment may
     * run its own Unbound somewhere else entirely.
     */
    RESOLVER_ADDRESS: z.string().min(1).default("127.0.0.1"),
    RESOLVER_PORT: z.coerce.number().int().min(1).max(65_535).default(53),
    SENTRY_DSN: z.string().url().optional(),
  },
});
