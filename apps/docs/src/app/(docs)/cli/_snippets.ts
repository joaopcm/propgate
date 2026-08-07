/**
 * `CONFIG_PATH` and `PRECEDENCE` are read off `packages/cli/src/config.ts`
 * (`configDir`, `configPath`, `credentials`) rather than a captured run —
 * there is no terminal output for "where a file lives".
 */

export const INSTALL_NPX = "npx @propgate/cli check example.com";

export const INSTALL_GLOBAL = `npm install -g @propgate/cli
propgate check example.com`;

export const CONFIG_PATH = "$XDG_CONFIG_HOME/propgate/config.json  (mode 0600)";

export const GUIDED = `$ propgate domains add example.com

│  Which profile should this domain satisfy?
│  sending
│
│  Your own id for this domain, if you have one
│  cust_1
│
example.com registered as 019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a.
Nothing has been checked yet — the sweeper will pick it up.`;

export const NON_INTERACTIVE = `$ CI=true propgate domains add example.com
propgate: domains add needs --profile.
Pass it, or run in a terminal without --json for the guided flow.

$ echo $?
64`;

export const PRECEDENCE = `1. --api-url                  (flag, account commands only)
2. PROPGATE_API_URL           (env)
3. apiUrl in config.json      (written by confirm, non-default only)
4. https://api.propgate.dev   (default)

1. PROPGATE_API_KEY           (env)
2. apiKey in config.json      (written by confirm)`;
