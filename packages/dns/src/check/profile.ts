/**
 * What a domain is *for*.
 *
 * The MX evaluator made this unavoidable: a null MX is correct on a
 * sending-only domain and a total failure on one that receives mail, and no
 * amount of looking at DNS distinguishes them. The same is true throughout —
 * whether a missing DKIM selector matters depends on whether the platform
 * issued one, and whether an unauthorised CA matters depends on whether
 * certificates are being issued at all.
 *
 * A profile is plain data, deliberately. It is the one place a caller states
 * intent, so it has to be something they can write down, store next to the
 * domain, and diff when the answer changes. Anything computed from DNS belongs
 * in an evaluator, not here.
 */

export const CHECK_KINDS = [
  "delegation",
  "spf",
  "dkim",
  "dmarc",
  "mx",
  "caa",
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

export interface DomainProfile {
  /**
   * The certificate authority that must be authorised.
   *
   * Omit when certificates are not part of what this domain is for; the CAA
   * check is skipped rather than run without an expectation, because "any CA
   * may issue" is only worth reporting to someone who cares which one does.
   */
  readonly caaIssuer?: string;
  /** Which checks to run. Anything absent is not merely passing — it is unasked. */
  readonly checks: readonly CheckKind[];
  /** Selectors the platform issued. Empty means DKIM is not expected here. */
  readonly dkimSelectors?: readonly string[];
  /**
   * Whether this domain is meant to receive mail.
   *
   * Omit when the caller does not know. Undeliverable mail is only a fault if
   * someone said the domain should receive it.
   */
  readonly expectsMail?: boolean;
  /** Stable identifier, stored alongside the domain and reported in results. */
  readonly id: string;
  /** The `include:` token the platform publishes, if SPF authorisation matters. */
  readonly spfInclude?: string;
  /** A specific sending address to evaluate SPF against. */
  readonly spfIp?: string;
}

/**
 * A domain that sends through a platform and receives nothing.
 *
 * The common case for a transactional-email customer, and the one where a null
 * MX is the right answer rather than a fault.
 */
export function sendingOnly(options: {
  dkimSelectors?: readonly string[];
  spfInclude?: string;
}): DomainProfile {
  return {
    checks: ["delegation", "spf", "dkim", "dmarc", "mx"],
    expectsMail: false,
    id: "sending-only",
    ...(options.dkimSelectors === undefined
      ? {}
      : { dkimSelectors: options.dkimSelectors }),
    ...(options.spfInclude === undefined
      ? {}
      : { spfInclude: options.spfInclude }),
  };
}

/** A domain that both sends and receives. */
export function fullMail(options: {
  dkimSelectors?: readonly string[];
  spfInclude?: string;
}): DomainProfile {
  return {
    ...sendingOnly(options),
    expectsMail: true,
    id: "full-mail",
  };
}

/**
 * A domain that serves a site and sends no mail.
 *
 * Deliberately does not run the mail checks. A domain with no SPF record is not
 * misconfigured if nobody sends as it, and reporting it as such is how a
 * checker teaches people to ignore its output.
 */
export function webOnly(options: { caaIssuer?: string }): DomainProfile {
  return {
    checks:
      options.caaIssuer === undefined ? ["delegation"] : ["delegation", "caa"],
    expectsMail: false,
    id: "web-only",
    ...(options.caaIssuer === undefined
      ? {}
      : { caaIssuer: options.caaIssuer }),
  };
}
