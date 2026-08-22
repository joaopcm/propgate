export const SIGNUP_CURL = `curl -X POST https://api.propgate.dev/v1/signup \\
  -H "content-type: application/json" \\
  -d '{"email":"you@example.com"}'

curl -X POST https://api.propgate.dev/v1/signup/confirm \\
  -H "content-type: application/json" \\
  -d '{"email":"you@example.com","code":"123456"}'`;

export const SIGNUP_CLI = `npx @propgate/cli signup  --email you@example.com
npx @propgate/cli confirm --email you@example.com --code 123456`;

export const AUTH_HEADER_CURL = `curl https://api.propgate.dev/v1/domains \\
  -H "Authorization: Bearer pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`;

export const AUTH_HEADER_CLI =
  "PROPGATE_API_KEY=pg_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx npx @propgate/cli domains list";

export const REVOKED_401 = `{
  "data": null,
  "error": {
    "message": "this API key has been revoked"
  },
  "meta": null
}`;

export const UNKNOWN_401 = `{
  "data": null,
  "error": {
    "message": "invalid API key"
  },
  "meta": null
}`;

export const AUTH_HEADER_SDK = `import { Propgate } from "@propgate/sdk";

const propgate = new Propgate(process.env.PROPGATE_API_KEY);

const { error } = await propgate.members.list();

error?.code;`;
