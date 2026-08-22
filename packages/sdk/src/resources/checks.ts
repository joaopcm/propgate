import type { Caller, CallOptions } from "../caller";
import type { PropgateResult } from "../envelope";
import type { Check, CheckKind } from "../types";

export interface CheckRequest {
  readonly caaIssuer?: string;
  readonly checks?: readonly CheckKind[];
  readonly cnames?: readonly {
    readonly label: string;
    readonly target: string;
  }[];
  readonly dkimSelectors?: readonly string[];
  readonly domain: string;
  readonly expectsMail?: boolean;
  readonly ownership?: readonly {
    readonly label?: string;
    readonly token: string;
  }[];
  readonly spfInclude?: string;
  readonly spfIp?: string;
}

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
