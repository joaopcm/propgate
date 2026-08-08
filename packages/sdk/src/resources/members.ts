import type { Caller, CallOptions } from "../caller";
import type { PropgateResult } from "../envelope";
import type { Member } from "../types";

/**
 * `GET /v1/members` — who is on this account.
 *
 * Read-only, and deliberately so. A member is added exactly one way — by proving
 * control of a mailbox through the signup flow — and removing one needs roles,
 * which do not exist yet.
 *
 * It is what turns the `createdBy` address on an API key into something you can
 * check: without it, nothing says which addresses are supposed to be there.
 */

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
