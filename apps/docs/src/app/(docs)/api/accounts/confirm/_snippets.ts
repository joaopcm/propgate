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
