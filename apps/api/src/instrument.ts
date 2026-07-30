import { init } from "@sentry/node";

// Reads raw process.env rather than ./env so this can be imported before
// env validation runs. A missing DSN makes the whole module a no-op, which
// is the normal state in development and in CI.
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,
  });
}
