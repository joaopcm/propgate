/**
 * The request is quoted verbatim from QUICKSTART.md. The one entry inside
 * `data` is also quoted verbatim from there (the object that appears after
 * "Fix the missing record, wait for the TTL, check again"); the envelope and
 * `object` field around it are a shape read off the route handler
 * (`route.get("/:id/timeline", ...)` in `apps/api/src/routes/domains.ts`),
 * which QUICKSTART.md does not print in full.
 */

export const TIMELINE_CURL = `curl -s https://api.propgate.dev/v1/domains/019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a/timeline \\
  -H "authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const TIMELINE_RESPONSE = `{
  "data": [
    {
      "current": "pass",
      "object": "record_change",
      "observedAt": "2026-08-03T14:02:11.000Z",
      "previous": "fail:DKIM_RECORD_MISSING",
      "requirementKey": "dkim"
    }
  ],
  "error": null,
  "meta": null
}`;
