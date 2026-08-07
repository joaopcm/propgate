import type { Caller, CallOptions } from "../caller";
import { segment } from "../caller";
import type { PropgateResult } from "../envelope";
import type {
  Domain,
  DomainDetail,
  DomainExpectations,
  DomainState,
  PageMeta,
  RecordChange,
} from "../types";

/**
 * The domain lifecycle: register, verify, read, delete.
 *
 * `create` and `check` are separate calls on purpose, and the separation is the
 * whole reason importing ten thousand domains is not ten thousand DNS runs.
 * Registration is a write; verification is an action with latency and side
 * effects.
 */

export interface DomainCreateInput {
  /**
   * The values this domain supplies for whatever its profile defers, keyed by
   * requirement key and then by field.
   *
   * A profile that requires a per-domain field and a `create` that omits it is
   * refused with a 422 naming the missing path — rather than accepted and left
   * reporting `indeterminate` forever.
   */
  readonly expectations?: DomainExpectations;
  /** Your identifier for this domain. Re-sending it makes `create` idempotent. */
  readonly externalId?: string;
  readonly name: string;
  /** The profile key to judge this domain against. */
  readonly profile: string;
}

/**
 * Changing what a domain is judged against.
 *
 * Supply `expectations`, `profile`, or both — a request that changes nothing is
 * refused, because it would still reset the domain to `pending` and re-verify
 * it.
 *
 * This is the call for a key rotation. Re-sending `create` with the same
 * `externalId` answers 200 having written nothing, and a success response for a
 * no-op with the sweeper still comparing the old key is the worst available
 * failure.
 */
export interface DomainUpdateInput {
  readonly expectations?: DomainExpectations;
  readonly profile?: string;
}

export interface DomainListQuery {
  readonly cursor?: string;
  readonly externalId?: string;
  /** Clamped to 200 server-side. Defaults to 50. */
  readonly limit?: number;
  readonly state?: DomainState;
}

/** Whether this call registered the domain or matched an existing `externalId`. */
export interface CreatedMeta {
  readonly created: boolean;
}

export interface ProfileVersionMeta {
  readonly profileVersionId: string;
}

/**
 * `resolver` on a check that ran, `superseded` on one whose answer was
 * discarded.
 *
 * A check is superseded when the domain's configuration changed while it was
 * running: the verdict describes an expectation set that no longer applies, so
 * it is thrown away and the domain comes back as it now stands — `pending`,
 * against the values you just wrote.
 */
export interface DomainCheckMeta {
  readonly resolver?: string;
  readonly superseded?: boolean;
}

export class Domains {
  private readonly api: Caller;

  constructor(api: Caller) {
    this.api = api;
  }

  create(
    input: DomainCreateInput,
    options: CallOptions = {}
  ): Promise<PropgateResult<DomainDetail, CreatedMeta>> {
    return this.api.request<DomainDetail, CreatedMeta>({
      body: input,
      method: "POST",
      path: "/v1/domains",
      ...options,
    });
  }

  list(
    query: DomainListQuery = {},
    options: CallOptions = {}
  ): Promise<PropgateResult<readonly Domain[], PageMeta>> {
    return this.api.request<readonly Domain[], PageMeta>({
      method: "GET",
      path: "/v1/domains",
      query: { ...query },
      ...options,
    });
  }

  /**
   * Every domain matching the filter, following the cursor to the end.
   *
   * One request per 200 rows. Reconciling ten thousand domains is fifty round
   * trips, comfortably inside the per-tenant rate limit.
   */
  listAll(
    query: Omit<DomainListQuery, "cursor" | "limit"> = {},
    options: CallOptions = {}
  ): Promise<PropgateResult<readonly Domain[]>> {
    return this.api.collect<Domain>({
      method: "GET",
      path: "/v1/domains",
      query: { ...query },
      ...options,
    });
  }

  get(
    id: string,
    options: CallOptions = {}
  ): Promise<PropgateResult<DomainDetail>> {
    return this.api.request<DomainDetail>({
      method: "GET",
      path: `/v1/domains/${segment(id)}`,
      ...options,
    });
  }

  update(
    id: string,
    input: DomainUpdateInput,
    options: CallOptions = {}
  ): Promise<PropgateResult<DomainDetail, ProfileVersionMeta>> {
    return this.api.request<DomainDetail, ProfileVersionMeta>({
      body: input,
      method: "PATCH",
      path: `/v1/domains/${segment(id)}`,
      ...options,
    });
  }

  /**
   * Check this domain now, and store what was found.
   *
   * Rate limited to 100 a minute per tenant, because each one aims real queries
   * at somebody else's authoritative servers. Bulk re-verification is the
   * sweeper's job and does not come through here.
   */
  check(
    id: string,
    options: CallOptions = {}
  ): Promise<PropgateResult<DomainDetail, DomainCheckMeta>> {
    return this.api.request<DomainDetail, DomainCheckMeta>({
      method: "POST",
      path: `/v1/domains/${segment(id)}/checks`,
      ...options,
    });
  }

  /**
   * What actually changed in this domain's records, newest first.
   *
   * Only differences are stored, so two identical checks add nothing — which is
   * what keeps this a timeline rather than a log of every check ever run.
   */
  timeline(
    id: string,
    query: { readonly limit?: number } = {},
    options: CallOptions = {}
  ): Promise<PropgateResult<readonly RecordChange[]>> {
    return this.api.request<readonly RecordChange[]>({
      method: "GET",
      path: `/v1/domains/${segment(id)}/timeline`,
      query: { ...query },
      ...options,
    });
  }

  /** Stop tracking this domain. The sweeper inherits everything you never delete. */
  remove(
    id: string,
    options: CallOptions = {}
  ): Promise<
    PropgateResult<{ readonly deleted: boolean; readonly id: string }>
  > {
    return this.api.request<{ readonly deleted: boolean; readonly id: string }>(
      {
        method: "DELETE",
        path: `/v1/domains/${segment(id)}`,
        ...options,
      }
    );
  }
}
