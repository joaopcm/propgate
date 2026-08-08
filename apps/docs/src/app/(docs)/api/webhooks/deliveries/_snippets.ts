/**
 * Shapes from the deliveries handler in `apps/api/src/routes/webhooks.ts`,
 * which builds its own response object rather than going through
 * `serialise`. The `payload` field mirrors the wire format documented at
 * `/webhooks`.
 */

export const DELIVERIES_CURL = `curl -s "https://api.propgate.dev/v1/webhooks/019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b/deliveries?status=failed" \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const DELIVERIES_RESPONSE = `{
  "data": [
    {
      "attempts": 6,
      "createdAt": "2026-08-03T12:05:00.000Z",
      "deliveredAt": null,
      "domainId": "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a",
      "event": "domain.failed",
      "id": "019fcfa1-4d5e-7f60-b17c-8d9e0f1a2b3c",
      "lastError": "connect ECONNREFUSED",
      "object": "webhook_delivery",
      "payload": {
        "type": "domain.failed",
        "created_at": "2026-08-03T12:05:00.000Z",
        "data": {
          "id": "019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a",
          "domain": "yourdomain.dev",
          "external_id": "cust_1",
          "previous_state": "verified",
          "state": "failed",
          "reason": "3 consecutive failures, reaching the failed threshold"
        }
      },
      "status": "failed"
    }
  ],
  "error": null,
  "meta": {
    "nextCursor": null
  }
}`;

/**
 * The SDK calls assume a client constructed once, as `/sdk` shows:
 * `const propgate = new Propgate(process.env.PROPGATE_API_KEY)`. Every method
 * name and shape here is checked against `@propgate/sdk` itself by
 * `src/lib/sdk.spec.ts`, so a renamed method fails rather than shipping.
 */

export const DELIVERIES_SDK = `const { data, meta } = await propgate.webhooks.listDeliveries("019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b", {
  status: "failed",
});

// Or every page of them, newest first.
const all = await propgate.webhooks.listAllDeliveries("019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b", {
  status: "failed",
});`;
