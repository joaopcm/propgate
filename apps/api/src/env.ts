import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  emptyStringAsUndefined: true,
  runtimeEnv: process.env,
  server: {
    CHECK_CONCURRENCY: z.coerce.number().int().min(1).default(4),
    DATABASE_URL: z.string().url(),
    DEGRADED_AFTER_FAILURES: z.coerce.number().int().min(1).default(1),
    EMAIL_FROM: z
      .string()
      .min(1)
      .default("propgate <accounts@notifications.propgate.dev>"),
    FAILED_AFTER_FAILURES: z.coerce.number().int().min(1).default(3),
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().default(3001),
    REDIS_URL: z.string().url(),
    RESEND_API_KEY: z.string().min(1),
    RESEND_SEGMENT_ID: z.string().min(1).optional(),
    RESOLVER_ADDRESS: z.string().min(1).default("127.0.0.1"),
    RESOLVER_ADDRESSES: z.string().optional(),
    RESOLVER_PORT: z.coerce.number().int().min(1).max(65_535).default(53),
    SENTRY_DSN: z.string().url().optional(),
    SWEEP_BATCH_SIZE: z.coerce.number().int().min(1).default(100),
    SWEEP_LEASE_SECONDS: z.coerce.number().int().min(1).default(300),
    SWEEP_TICK_SECONDS: z.coerce.number().int().min(1).default(60),
    WEBHOOK_ATTEMPTS: z.coerce.number().int().min(1).default(5),
    WEBHOOK_TIMEOUT_MS: z.coerce.number().int().min(1).default(10_000),
    WORKBENCH_PASS: z.string().min(1).optional(),
    WORKBENCH_PORT: z.coerce.number().int().min(1).max(65_535).default(3002),
    WORKBENCH_USER: z.string().min(1).optional(),
  },
});
