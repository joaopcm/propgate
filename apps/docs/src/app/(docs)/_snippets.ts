export const CHECK_CURL = `curl -s -X POST https://api.propgate.dev/v1/checks \\
  -H 'content-type: application/json' -d '{"domain":"github.com"}'`;

export const CHECK_CLI = "npx @propgate/cli check github.com";

export const CHECK_SDK = `import { Propgate } from "@propgate/sdk";

const { data } = await new Propgate().checks.run({ domain: "github.com" });`;
