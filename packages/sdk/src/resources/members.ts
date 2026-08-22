import type { Caller, CallOptions } from "../caller";
import type { PropgateResult } from "../envelope";
import type { Member } from "../types";

export class Members {
  private readonly api: Caller;

  constructor(api: Caller) {
    this.api = api;
  }

  list(options: CallOptions = {}): Promise<PropgateResult<readonly Member[]>> {
    return this.api.request<readonly Member[]>({
      method: "GET",
      path: "/v1/members",
      ...options,
    });
  }
}
