import { signPayload } from "./sign";

/**
 * One HTTP attempt, and what its result means for retrying.
 *
 * The classification is the whole content of this file. Retrying everything
 * forever turns a customer's misconfigured endpoint into us hammering them a few
 * hundred times; retrying nothing turns their thirty-second deploy into lost
 * events. So the outcome is a three-way decision rather than a boolean.
 */

export type DeliveryOutcome =
  | { readonly kind: "delivered"; readonly status: number }
  /** Worth trying again: their problem is plausibly temporary. */
  | { readonly error: string; readonly kind: "retryable" }
  /**
   * Not worth trying again.
   *
   * A 400 or a 404 means this request will never be accepted, and forty more
   * attempts will not change that. Dead-lettering immediately puts it in front of
   * the customer through the deliveries endpoint, which is where a wrong URL gets
   * noticed — a silent retry loop is how nobody finds out for a week.
   */
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
  /** Unix seconds, injected so a spec can pin the signature. */
  readonly timestamp: number;
  readonly url: string;
}

/**
 * 408 and 429 are retryable despite being 4xx.
 *
 * A timeout is by definition temporary, and rate limiting is a request to come
 * back later rather than a refusal — treating either as permanent would drop
 * events for an endpoint that is merely busy.
 */
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

  /**
   * Redirects are permanent failures, not followed.
   *
   * `fetch` would follow one silently, which means a signed POST could end up at
   * a host the customer never configured — and the signature would still verify
   * there. Refusing and saying so is the only safe reading.
   */
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
      // Never follow. See `classify`.
      redirect: "manual",
      signal: AbortSignal.timeout(options.timeoutMs),
    });

    return classify(response.status);
  } catch (cause) {
    /**
     * A socket error or a timeout, both retryable.
     *
     * DNS failures land here too, which is worth noticing: a customer's webhook
     * host being briefly unresolvable is exactly the transient condition retries
     * exist for, and it would be a strange product that gave up on it.
     */
    return {
      error: cause instanceof Error ? cause.message : String(cause),
      kind: "retryable",
    };
  }
}
