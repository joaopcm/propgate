import type { Database } from "@propgate/db";
import { domainById, profileVersionById } from "@propgate/db";
import type { CheckDomainPayload } from "@propgate/jobs";
import type { CheckedDomain, CheckSettings } from "../domains/check";
import { checkAndPersist } from "../domains/check";

export interface CheckDomainDeps {
  readonly db: Database;
  readonly settings: CheckSettings;
}

export type CheckDomainOutcome =
  | {
      readonly checked: CheckedDomain;
      readonly domain: {
        readonly externalId: string | null;
        readonly name: string;
      };
      readonly kind: "checked";
    }
  | { readonly kind: "gone" }
  | { readonly kind: "profile-missing"; readonly profileVersionId: string }
  | { readonly kind: "superseded" };

export async function checkClaimedDomain(
  deps: CheckDomainDeps,
  payload: CheckDomainPayload
): Promise<CheckDomainOutcome> {
  const domain = await domainById(deps.db, payload.tenantId, payload.domainId);

  if (domain === undefined) {
    return { kind: "gone" };
  }

  const profile = await profileVersionById(
    deps.db,
    payload.tenantId,
    domain.profileVersionId
  );

  if (profile === undefined) {
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

  if (checked === null) {
    return { kind: "superseded" };
  }

  return {
    checked,
    domain: { externalId: domain.externalId, name: domain.name },
    kind: "checked",
  };
}
