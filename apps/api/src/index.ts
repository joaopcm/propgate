import "./instrument";
import { serve } from "@hono/node-server";
import app from "./app";
import { env } from "./env";

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  process.stdout.write(`propgate api listening on port ${info.port}\n`);
});

// This process is long-lived by design — the sweeper that arrives in Phase 2
// is a continuous loop, which is exactly what per-invocation billing is worst
// at. Shut down cleanly so in-flight lookups aren't cut off mid-query.
function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
