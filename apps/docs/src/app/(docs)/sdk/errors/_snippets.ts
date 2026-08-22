export const ERRORS_SHAPE = `const { data, error } = await propgate.domains.get("019fcf7a-...");

if (error !== null) {
  error.code;
  error.message;
  error.statusCode;
  error.retryAfterSeconds;
}`;

export const ERRORS_SWITCH = `const { data, error } = await propgate.domains.create({
  name: "yourdomain.dev",
  profile: "sending",
});

switch (error?.code) {
  case undefined:
    return data;
  case "conflict":
    return await propgate.domains.list({ externalId: "cust_1" });
  case "invalid_request":
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
  await enqueueRetryIn(error.retryAfterSeconds ?? 60);
}`;

export const ERRORS_RETRIES = `const propgate = new Propgate(process.env.PROPGATE_API_KEY, { maxRetries: 2 });

const once = new Propgate(process.env.PROPGATE_API_KEY, { maxRetries: 0 });`;
