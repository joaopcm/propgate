import type { Database } from "@propgate/db";
import { domainById, profileVersionById } from "@propgate/db";
import type { CheckDomainPayload } from "@propgate/jobs";
import type { CheckedDomain, CheckSettings } from "../domains/check";
import { checkAndPersist } from "../domains/check";

/**
 * One domain, checked because time passed.
 *
 * Everything of substance is in `checkAndPersist`, which the verify route also
 * calls. What lives here is only what differs: reading the row back, and deciding
 * what a missing row or a missing profile means when there is no request to
 * return an error to.
 */

export interface CheckDomainDeps {
  readonly db: Database;
  readonly settings: CheckSettings;
}

export type CheckDomainOutcome =
  | { readonly kind: "checked"; readonly checked: CheckedDomain }
  | { readonly kind: "gone" }
  | { readonly kind: "profile-missing"; readonly profileVersionId: string };

export async function checkClaimedDomain(
  deps: CheckDomainDeps,
  payload: CheckDomainPayload
): Promise<CheckDomainOutcome> {
  /**
   * Re-read rather than trust the payload.
   *
   * The job carries identifiers precisely so that this read is the only source of
   * truth about the domain. Between the claim and now it may have been deleted or
   * re-pointed at a new profile version, and a check written from claim-time state
   * would persist a verdict against a profile the customer has since replaced.
   */
  const domain = await domainById(deps.db, payload.tenantId, payload.domainId);

  if (domain === undefined) {
    // Deleted between the claim and now. Not an error: the customer removed it,
    // and there is nothing left to check or to reschedule. Throwing would retry
    // the job three times and then dead-letter a row that is meant to be gone.
    return { kind: "gone" };
  }

  const profile = await profileVersionById(
    deps.db,
    payload.tenantId,
    domain.profileVersionId
  );

  if (profile === undefined) {
    /**
     * The `profile_version_id` reference deliberately does not cascade, so this
     * should be impossible. If it happens the domain cannot be evaluated at all,
     * and the honest move is to fail the job loudly: it lands in Workbench's
     * failed set with the ids in the payload, which is exactly the breadcrumb
     * needed to work out how the reference was broken.
     *
     * Returned rather than thrown so the caller decides — the worker throws, and
     * a spec can assert the outcome without catching.
     */
    return {
      kind: "profile-missing",
      profileVersionId: domain.profileVersionId,
    };
  }

  const checked = await checkAndPersist(deps.db, {
    domain: { ...domain, tenantId: payload.tenantId },
    profile: { definition: profile.definition, id: profile.id },
    settings: deps.settings,
  });

  return { checked, kind: "checked" };
}
