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

export interface DomainCreateInput {
  readonly expectations?: DomainExpectations;
  readonly externalId?: string;
  readonly name: string;
  readonly profile: string;
}

export interface DomainUpdateInput {
  readonly expectations?: DomainExpectations;
  readonly profile?: string;
}

export interface DomainListQuery {
  readonly cursor?: string;
  readonly externalId?: string;
  readonly limit?: number;
  readonly state?: DomainState;
}

export interface CreatedMeta {
  readonly created: boolean;
}

export interface ProfileVersionMeta {
  readonly profileVersionId: string;
}

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
