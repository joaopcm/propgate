import type { Caller, CallOptions } from "../caller";
import { segment } from "../caller";
import type { PropgateResult } from "../envelope";
import type { Profile, ProfileRequirement } from "../types";

/**
 * `/v1/profiles` — what a tenant expects of a domain's records.
 *
 * There is no update call and that is not an omission: writing a profile that
 * already exists creates a new *version* of it, because domains pin the version
 * they were registered against. An existing domain keeps being judged by what it
 * was registered against until something re-points it — see `domains.update`.
 */

export interface ProfileCreateInput {
  readonly key: string;
  readonly requirements: readonly ProfileRequirement[];
}

export class Profiles {
  private readonly api: Caller;

  constructor(api: Caller) {
    this.api = api;
  }

  /** Create the profile, or a new version of it if the key already exists. */
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

  /** The current version of a profile, by key. */
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
