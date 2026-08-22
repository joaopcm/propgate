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

export const TIMELINE_SDK = `const { data } = await propgate.domains.timeline("019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a", { limit: 50 });`;
