import type { Caller, CallOptions } from "../caller";
import { segment } from "../caller";
import type { PropgateResult } from "../envelope";
import type {
  CreatedWebhook,
  DeliveryStatus,
  PageMeta,
  Webhook,
  WebhookDelivery,
  WebhookEvent,
  WebhookSecret,
} from "../types";
import type { CreatedMeta } from "./domains";

/**
 * `/v1/webhooks` — where domain state changes are sent, and what happened to
 * them.
 *
 * Deliveries are nested under the endpoint they belong to, because a delivery
 * belongs to exactly one endpoint and "did *this* endpoint receive it" is the
 * question that gets asked.
 *
 * Verifying a signature is `@propgate/webhooks`' job, not this package's: the
 * receiving side is a request handler, and it should not have to construct an
 * API client to check a signature.
 */

export interface WebhookCreateInput {
  /** Which events to send. Empty or omitted means all of them. */
  readonly events?: readonly WebhookEvent[];
  /** `https` only, and never a private or loopback address. */
  readonly url: string;
}

export interface WebhookUpdateInput {
  readonly disabled?: boolean;
  readonly events?: readonly WebhookEvent[];
}

export interface WebhookRotateInput {
  /**
   * How long the previous secret keeps being accepted, in hours.
   *
   * Defaults to 24 — a deploy window, so a customer who rotates and redeploys on
   * their own schedule is never broken. Zero expires the old secret immediately,
   * which is the right answer when you are rotating *because* something leaked.
   */
  readonly windowHours?: number;
}

export interface DeliveryListQuery {
  readonly cursor?: string;
  /** Clamped to 200 server-side. Defaults to 50. */
  readonly limit?: number;
  readonly status?: DeliveryStatus;
}

/** When the previous signing secret stops being accepted. */
export interface RotationMeta {
  readonly previousSecretExpiresAt: string;
}

export class Webhooks {
  private readonly api: Caller;

  constructor(api: Caller) {
    this.api = api;
  }

  /**
   * Register an endpoint. The signing secret is in `data.secret`, once.
   *
   * Idempotent on the URL: creating the same endpoint twice returns the existing
   * one with `meta.created` false and no secret, because a retry must not be a
   * way to read a secret somebody else set up. Lost it? `rotateSecret`.
   */
  create(
    input: WebhookCreateInput,
    options: CallOptions = {}
  ): Promise<PropgateResult<CreatedWebhook, CreatedMeta>> {
    return this.api.request<CreatedWebhook, CreatedMeta>({
      body: input,
      method: "POST",
      path: "/v1/webhooks",
      ...options,
    });
  }

  list(options: CallOptions = {}): Promise<PropgateResult<readonly Webhook[]>> {
    return this.api.request<readonly Webhook[]>({
      method: "GET",
      path: "/v1/webhooks",
      ...options,
    });
  }

  get(id: string, options: CallOptions = {}): Promise<PropgateResult<Webhook>> {
    return this.api.request<Webhook>({
      method: "GET",
      path: `/v1/webhooks/${segment(id)}`,
      ...options,
    });
  }

  update(
    id: string,
    input: WebhookUpdateInput,
    options: CallOptions = {}
  ): Promise<PropgateResult<Webhook>> {
    return this.api.request<Webhook>({
      body: input,
      method: "PATCH",
      path: `/v1/webhooks/${segment(id)}`,
      ...options,
    });
  }

  remove(
    id: string,
    options: CallOptions = {}
  ): Promise<
    PropgateResult<{ readonly deleted: boolean; readonly id: string }>
  > {
    return this.api.request<{ readonly deleted: boolean; readonly id: string }>(
      {
        method: "DELETE",
        path: `/v1/webhooks/${segment(id)}`,
        ...options,
      }
    );
  }

  /** Issue a new signing secret, keeping the old one valid for a window. */
  rotateSecret(
    id: string,
    input: WebhookRotateInput = {},
    options: CallOptions = {}
  ): Promise<PropgateResult<WebhookSecret, RotationMeta>> {
    return this.api.request<WebhookSecret, RotationMeta>({
      body: input,
      method: "POST",
      path: `/v1/webhooks/${segment(id)}/secret`,
      ...options,
    });
  }

  /** What this endpoint was sent, newest first. */
  listDeliveries(
    id: string,
    query: DeliveryListQuery = {},
    options: CallOptions = {}
  ): Promise<PropgateResult<readonly WebhookDelivery[], PageMeta>> {
    return this.api.request<readonly WebhookDelivery[], PageMeta>({
      method: "GET",
      path: `/v1/webhooks/${segment(id)}/deliveries`,
      query: { ...query },
      ...options,
    });
  }

  /**
   * Every delivery matching the filter, following the cursor to the end.
   *
   * Deliveries sort newest first, so anything created while the walk is in
   * progress is missed rather than duplicated. For an audit that must not miss
   * one, walk again from the top rather than resuming a stale cursor.
   */
  listAllDeliveries(
    id: string,
    query: Omit<DeliveryListQuery, "cursor" | "limit"> = {},
    options: CallOptions = {}
  ): Promise<PropgateResult<readonly WebhookDelivery[]>> {
    return this.api.collect<WebhookDelivery>({
      method: "GET",
      path: `/v1/webhooks/${segment(id)}/deliveries`,
      query: { ...query },
      ...options,
    });
  }
}
