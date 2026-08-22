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

export interface WebhookCreateInput {
  readonly events?: readonly WebhookEvent[];
  readonly url: string;
}

export interface WebhookUpdateInput {
  readonly disabled?: boolean;
  readonly events?: readonly WebhookEvent[];
}

export interface WebhookRotateInput {
  readonly windowHours?: number;
}

export interface DeliveryListQuery {
  readonly cursor?: string;
  readonly limit?: number;
  readonly status?: DeliveryStatus;
}

export interface RotationMeta {
  readonly previousSecretExpiresAt: string;
}

export class Webhooks {
  private readonly api: Caller;

  constructor(api: Caller) {
    this.api = api;
  }

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
