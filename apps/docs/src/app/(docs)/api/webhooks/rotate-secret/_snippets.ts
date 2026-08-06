/**
 * Shapes from the secret-rotation handler in
 * `apps/api/src/routes/webhooks.ts`, which builds its own response object
 * rather than going through `serialise`.
 */

export const ROTATE_CURL = `curl -s -X POST https://api.propgate.dev/v1/webhooks/019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b/secret \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{"windowHours":24}'`;

export const ROTATE_RESPONSE = `{
  "data": {
    "id": "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b",
    "object": "webhook_secret",
    "secret": "whsec_..."
  },
  "error": null,
  "meta": {
    "previousSecretExpiresAt": "2026-08-04T12:00:00.000Z"
  }
}`;

export const ROTATE_LEAK_CURL = `curl -s -X POST https://api.propgate.dev/v1/webhooks/019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b/secret \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' -d '{"windowHours":0}'`;
