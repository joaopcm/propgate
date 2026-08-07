import type { Caller, CallOptions } from "../caller";
import type { PropgateResult } from "../envelope";
import type { Check, CheckKind } from "../types";

/**
 * `POST /v1/checks` — everything propgate knows about one domain, right now.
 *
 * The only call here that needs no API key. It stores nothing and schedules
 * nothing: this is the diagnosis engine, not the lifecycle. A domain you want
 * watched over time is `domains.create` plus `domains.check`.
 */

export interface CheckRequest {
  readonly caaIssuer?: string;
  /** Which checks to run. Every kind, when omitted. */
  readonly checks?: readonly CheckKind[];
  readonly cnames?: readonly {
    readonly label: string;
    readonly target: string;
  }[];
  readonly dkimSelectors?: readonly string[];
  readonly domain: string;
  /**
   * Whether this domain is meant to receive mail.
   *
   * Deliberately not defaulted. Omitting it asserts nothing, which is right for
   * a sending-only domain; sending `false` asserts that MX records would be a
   * mistake here.
   */
  readonly expectsMail?: boolean;
  readonly ownership?: readonly {
    readonly label?: string;
    readonly token: string;
  }[];
  readonly spfInclude?: string;
  readonly spfIp?: string;
}

/** Which resolver answered, as `address:port`. */
export interface ResolverMeta {
  readonly resolver: string;
}

export class Checks {
  private readonly api: Caller;

  constructor(api: Caller) {
    this.api = api;
  }

  run(
    request: CheckRequest,
    options: CallOptions = {}
  ): Promise<PropgateResult<Check, ResolverMeta>> {
    return this.api.request<Check, ResolverMeta>({
      anonymous: true,
      body: request,
      method: "POST",
      path: "/v1/checks",
      ...options,
    });
  }
}
