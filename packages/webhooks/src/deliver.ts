import { signPayload } from "./sign";

export type DeliveryOutcome =
  | { readonly kind: "delivered"; readonly status: number }
  | { readonly error: string; readonly kind: "retryable" }
  | {
      readonly error: string;
      readonly kind: "permanent";
      readonly status: number;
    };

export interface DeliverOptions {
  readonly body: string;
  readonly id: string;
  readonly secrets: readonly string[];
  readonly timeoutMs: number;
  readonly timestamp: number;
  readonly url: string;
}

const RETRYABLE_CLIENT_ERRORS = new Set([408, 429]);

const CLIENT_ERROR_FLOOR = 400;
const SERVER_ERROR_FLOOR = 500;
const SUCCESS_FLOOR = 200;
const REDIRECT_FLOOR = 300;

function classify(status: number): DeliveryOutcome {
  if (status >= SUCCESS_FLOOR && status < REDIRECT_FLOOR) {
    return { kind: "delivered", status };
  }

  if (status >= SERVER_ERROR_FLOOR || RETRYABLE_CLIENT_ERRORS.has(status)) {
    return { error: `HTTP ${status}`, kind: "retryable" };
  }

  if (status < CLIENT_ERROR_FLOOR) {
    return {
      error: `HTTP ${status}: redirects are not followed, because a signed request must only ever reach the URL you configured`,
      kind: "permanent",
      status,
    };
  }

  return { error: `HTTP ${status}`, kind: "permanent", status };
}

export async function deliver(
  options: DeliverOptions
): Promise<DeliveryOutcome> {
  const headers = signPayload({
    body: options.body,
    id: options.id,
    secrets: options.secrets,
    timestamp: options.timestamp,
  });

  try {
    const response = await fetch(options.url, {
      body: options.body,
      headers: { ...headers, "content-type": "application/json" },
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    return classify(response.status);
  } catch (cause) {
    return {
      error: cause instanceof Error ? cause.message : String(cause),
      kind: "retryable",
    };
  }
}
