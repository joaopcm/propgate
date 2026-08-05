/**
 * `SIGNUP_CURL`/`SIGNUP_CLI` and `SIGNUP_RESPONSE` are shapes read off
 * `apps/api/src/routes/signup.ts`, not a captured run — the flow this
 * endpoint starts ends in a mailbox, not a terminal. `SIGNUP_RESPONSE`
 * matches the body shown in `QUICKSTART.md`, which carries the same note.
 *
 * The two 422 bodies were produced by running the real `signupSchema` from
 * `signup.ts` against a missing and a too-short email in this repo's
 * installed zod, then passing the resulting issue through `firstIssue` —
 * not typed from memory, but not an HTTP capture either.
 */

export const SIGNUP_CURL = `curl -s -X POST https://api.propgate.dev/v1/signup \\
  -H "content-type: application/json" \\
  -d '{"email":"you@example.com"}'`;

export const SIGNUP_CLI = "propgate signup --email you@example.com";

export const SIGNUP_RESPONSE = `{
  "data": {
    "object": "signup",
    "status": "pending"
  },
  "error": null,
  "meta": null
}`;

export const SIGNUP_MISSING_EMAIL_422 = `{
  "data": null,
  "error": {
    "message": "email: Invalid input: expected string, received undefined"
  },
  "meta": null
}`;

export const SIGNUP_SHORT_EMAIL_422 = `{
  "data": null,
  "error": {
    "message": "email: Too small: expected string to have >=3 characters"
  },
  "meta": null
}`;

export const SIGNUP_RATE_LIMIT_429 = `{
  "data": null,
  "error": {
    "message": "too many signup requests; try again in 2117s"
  },
  "meta": null
}`;
