import type { Caller, CallOptions } from "../caller";
import { segment } from "../caller";
import type { PropgateResult } from "../envelope";
import type { ApiKey, CreatedApiKey } from "../types";

export interface ApiKeyCreateInput {
  readonly name: string;
}

export interface RevocationMeta {
  readonly alreadyRevoked: boolean;
}

export class ApiKeys {
  private readonly api: Caller;

  constructor(api: Caller) {
    this.api = api;
  }

  create(
    input: ApiKeyCreateInput,
    options: CallOptions = {}
  ): Promise<PropgateResult<CreatedApiKey>> {
    return this.api.request<CreatedApiKey>({
      body: input,
      method: "POST",
      path: "/v1/api-keys",
      ...options,
    });
  }

  list(options: CallOptions = {}): Promise<PropgateResult<readonly ApiKey[]>> {
    return this.api.request<readonly ApiKey[]>({
      method: "GET",
      path: "/v1/api-keys",
      ...options,
    });
  }

  revoke(
    id: string,
    options: CallOptions = {}
  ): Promise<PropgateResult<ApiKey, RevocationMeta>> {
    return this.api.request<ApiKey, RevocationMeta>({
      method: "DELETE",
      path: `/v1/api-keys/${segment(id)}`,
      ...options,
    });
  }
}
