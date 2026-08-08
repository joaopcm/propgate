/**
 * Errors and retries.
 *
 * The codes below are `PropgateErrorCode` from `@propgate/sdk`, and
 * `src/lib/sdk.spec.ts` asserts this page names every member of that union — a
 * code a consumer can receive and cannot look up is worse than no table.
 */

export const ERRORS_SHAPE = `const { data, error } = await propgate.domains.get("019fcf7a-...");

if (error !== null) {
  error.code; // "not_found"
  error.message; // "no such domain" — the API's own words, not a status line
  error.statusCode; // 404, or 0 when there was never a response
  error.retryAfterSeconds; // set on "rate_limited", undefined otherwise
}`;

export const ERRORS_SWITCH = `const { data, error } = await propgate.domains.create({
  name: "yourdomain.dev",
  profile: "sending",
});

switch (error?.code) {
  case undefined:
    return data;
  case "conflict":
    // Already registered under a different external id.
    return await propgate.domains.list({ externalId: "cust_1" });
  case "invalid_request":
    // The message names the field. Log it; retrying unchanged will not help.
    throw new Error(error.message);
  case "rate_limited":
    return schedule(error.retryAfterSeconds ?? 60);
  default:
    throw error;
}`;

export const ERRORS_THROWING = `import { PropgateError } from "@propgate/sdk";

async function must<T>(call: Promise<{ data: T | null; error: PropgateError | null }>) {
  const { data, error } = await call;

  if (error !== null) {
    throw error;
  }

  return data as T;
}

const domain = await must(propgate.domains.get("019fcf7a-..."));`;

export const ERRORS_RATE_LIMIT = `const { data, error } = await propgate.domains.check(id);

if (error?.code === "rate_limited") {
  // Anything short the client already waited out. This one outlasted it.
  await enqueueRetryIn(error.retryAfterSeconds ?? 60);
}`;

export const ERRORS_RETRIES = `// Two retries on top of the first attempt, and none of them on a POST that
// may already have been applied.
const propgate = new Propgate(process.env.PROPGATE_API_KEY, { maxRetries: 2 });

// Turn them off entirely when your own queue is the thing that retries.
const once = new Propgate(process.env.PROPGATE_API_KEY, { maxRetries: 0 });`;
