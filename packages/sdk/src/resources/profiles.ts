import type { Caller, CallOptions } from "../caller";
import { segment } from "../caller";
import type { PropgateResult } from "../envelope";
import type { Profile, ProfileRequirement } from "../types";

export interface ProfileCreateInput {
  readonly key: string;
  readonly requirements: readonly ProfileRequirement[];
}

export class Profiles {
  private readonly api: Caller;

  constructor(api: Caller) {
    this.api = api;
  }

  create(
    input: ProfileCreateInput,
    options: CallOptions = {}
  ): Promise<PropgateResult<Profile>> {
    return this.api.request<Profile>({
      body: input,
      method: "POST",
      path: "/v1/profiles",
      ...options,
    });
  }

  get(
    key: string,
    options: CallOptions = {}
  ): Promise<PropgateResult<Profile>> {
    return this.api.request<Profile>({
      method: "GET",
      path: `/v1/profiles/${segment(key)}`,
      ...options,
    });
  }
}
