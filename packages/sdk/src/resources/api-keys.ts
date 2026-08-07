import type { Caller, CallOptions } from "../caller";
import { segment } from "../caller";
import type { PropgateResult } from "../envelope";
import type { ApiKey, CreatedApiKey } from "../types";

/**
 * `/v1/api-keys` — a tenant managing its own credentials.
 *
 * Authenticating with the key you are revoking is fine, and rotating away from
 * something that leaked is exactly that move. What is refused is revoking your
 * last active key: there is no un-revoke, so it would lock you out of the API
 * with no way back in.
 */

export interface ApiKeyCreateInput {
  readonly name: string;
}

/**
 * Whether this call was the one that revoked the key.
 *
 * Not a failure either way — the key is revoked when this returns — but a script
 * re-running its own cleanup deserves to know it was not the one that did it.
 */
export interface RevocationMeta {
  readonly alreadyRevoked: boolean;
}

export class ApiKeys {
  private readonly api: Caller;

  constructor(api: Caller) {
    this.api = api;
  }

  /**
   * Mint a key. `data.key` is the only time the secret is ever readable.
   *
   * Not retried on a transport failure, unlike every other call here: this is
   * the one route where repeating a request that may have succeeded mints a
   * second key nobody knows about.
   */
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
