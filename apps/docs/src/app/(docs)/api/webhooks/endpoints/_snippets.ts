/**
 * None of these are captured — there is no equivalent webhooks section in
 * QUICKSTART.md to quote from. Every request and response below is a shape
 * read off `apps/api/src/routes/webhooks.ts`: its zod schemas for the
 * requests, and its `serialise` function (plus the two routes that build
 * their own object — secret rotation and deliveries) for the responses.
 */

export const CREATE_CURL = `curl -s -X POST https://api.propgate.dev/v1/webhooks \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' \\
  -d '{"url":"https://example.com/hooks/propgate","events":["domain.failed","domain.recovered"]}'`;

export const CREATE_RESPONSE = `{
  "data": {
    "createdAt": "2026-08-03T12:00:00.000Z",
    "disabled": false,
    "events": [
      "domain.failed",
      "domain.recovered"
    ],
    "id": "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b",
    "object": "webhook",
    "secret": "whsec_...",
    "url": "https://example.com/hooks/propgate"
  },
  "error": null,
  "meta": {
    "created": true
  }
}`;

export const CREATE_REJECTED = `{
  "data": null,
  "error": {
    "message": "10.0.0.5 is a private or loopback address, which this service will not send to"
  },
  "meta": null
}`;

export const LIST_CURL = `curl -s https://api.propgate.dev/v1/webhooks \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const LIST_RESPONSE = `{
  "data": [
    {
      "createdAt": "2026-08-03T12:00:00.000Z",
      "disabled": false,
      "events": [
        "domain.failed",
        "domain.recovered"
      ],
      "id": "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b",
      "object": "webhook",
      "url": "https://example.com/hooks/propgate"
    }
  ],
  "error": null,
  "meta": null
}`;

export const GET_CURL = `curl -s https://api.propgate.dev/v1/webhooks/019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const GET_NOT_FOUND = `{
  "data": null,
  "error": {
    "message": "no such webhook"
  },
  "meta": null
}`;

export const UPDATE_CURL = `curl -s -X PATCH https://api.propgate.dev/v1/webhooks/019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \\
  -H 'content-type: application/json' \\
  -d '{"disabled":true}'`;

export const UPDATE_RESPONSE = `{
  "data": {
    "createdAt": "2026-08-03T12:00:00.000Z",
    "disabled": true,
    "events": [
      "domain.failed",
      "domain.recovered"
    ],
    "id": "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b",
    "object": "webhook",
    "url": "https://example.com/hooks/propgate"
  },
  "error": null,
  "meta": null
}`;

export const DELETE_CURL = `curl -s -X DELETE https://api.propgate.dev/v1/webhooks/019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const DELETE_RESPONSE = `{
  "data": {
    "deleted": true,
    "id": "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b"
  },
  "error": null,
  "meta": null
}`;

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
