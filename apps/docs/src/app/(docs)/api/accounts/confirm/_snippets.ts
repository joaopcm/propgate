/**
 * `CONFIRM_CURL`/`CONFIRM_CLI` and `CONFIRM_RESPONSE` are shapes read off
 * `apps/api/src/routes/signup.ts`, not a captured run — this call ends in a
 * mailbox, not a terminal. `CONFIRM_RESPONSE` matches the body shown in
 * `QUICKSTART.md`, which carries the same note.
 *
 * `CONFIRM_SHORT_CODE_422` was produced by running the real `confirmSchema`
 * from `signup.ts` against a three-digit code in this repo's installed zod,
 * then passing the resulting issue through `firstIssue`. `CONFIRM_INVALID_409`
 * is copied verbatim from `signup.ts`.
 */

export const CONFIRM_CURL = `curl -s -X POST https://api.propgate.dev/v1/signup/confirm \\
  -H "content-type: application/json" \\
  -d '{"email":"you@example.com","code":"123456"}'`;

export const CONFIRM_CLI =
  "propgate confirm --email you@example.com --code 123456";

export const CONFIRM_RESPONSE = `{
  "data": {
    "apiKey": "pg_live_...",
    "created": true,
    "object": "account",
    "tenantId": "019fcf4f-..."
  },
  "error": null,
  "meta": null
}`;

export const CONFIRM_SHORT_CODE_422 = `{
  "data": null,
  "error": {
    "message": "code: Too small: expected string to have >=6 characters"
  },
  "meta": null
}`;

export const CONFIRM_INVALID_409 = `{
  "data": null,
  "error": {
    "message": "that code is not valid or has already been used; request a new one with POST /v1/signup"
  },
  "meta": null
}`;
