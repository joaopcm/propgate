import { captureException } from "@sentry/node";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

const app = new Hono();

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  captureException(err, {
    extra: { method: c.req.method, path: c.req.path },
  });

  return c.json(
    { data: null, error: { message: "Internal server error" }, meta: null },
    500
  );
});

app.get("/health", (c) => c.json({ status: "ok" }));

// Routes land here in Phase 1: POST /v1/checks (interactive, cache-busting)
// and GET /v1/dns/lookup (the raw per-vantage-point escape hatch).

export default app;
