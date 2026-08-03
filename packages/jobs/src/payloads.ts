/**
 * What a job carries: identifiers, and nothing else.
 *
 * Never a domain's state, its profile, or a result. Postgres is the truth and a
 * job is a pointer into it — by the time a job runs, the row it names may have
 * been re-registered, re-profiled or deleted, and a payload carrying a copy of
 * any of that would act on a snapshot that is no longer true. Re-reading costs
 * one indexed lookup and removes the entire class of bug.
 *
 * It is also what makes a flushed Redis survivable: a payload that is only an
 * id can always be reconstructed from the tables.
 */

export interface CheckDomainPayload {
  readonly domainId: string;
  /**
   * Carried alongside the domain id even though it is derivable from it.
   *
   * Every query in `packages/db` is tenant-scoped, and passing the tenant means
   * the worker's read is scoped the same way a request's would be rather than
   * reaching for a row by primary key alone. A job that somehow names a domain
   * from another tenant finds nothing instead of finding it.
   */
  readonly tenantId: string;
}

export interface DeliverWebhookPayload {
  readonly deliveryId: string;
  readonly tenantId: string;
}

/** Which of the two schedulers fired. Both claim work; only the reason differs. */
export interface SweepTickPayload {
  readonly reason: "reconcile" | "tick";
}
