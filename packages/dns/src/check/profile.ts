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
  "ownership",
  "cname",
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

/**
 * The kinds that answer a question per record rather than per domain.
 *
 * DKIM repeats per selector; ownership and cname repeat per name, because a
 * platform issuing a tracking host and a bounce host is issuing two aliases and
 * a merged verdict cannot say which one is missing. Everything else answers once
 * for the whole domain.
 *
 * Named here rather than inferred at each call site because three places depend
 * on the same fact — the profile, the outcome shape, and the API's rule about
 * which requirements may be written twice — and they must not drift.
 */
export const REPEATABLE_CHECK_KINDS = ["dkim", "ownership", "cname"] as const;

export type RepeatableCheckKind = (typeof REPEATABLE_CHECK_KINDS)[number];

export function isRepeatable(kind: CheckKind): kind is RepeatableCheckKind {
  return (REPEATABLE_CHECK_KINDS as readonly CheckKind[]).includes(kind);
}

/**
 * A selector, or a selector with the key that was issued for it.
 *
 * The bare string asks whether a valid key is published there. The object asks
 * whether the key we issued is the one published, which is the difference
 * between passing a domain that pasted a competitor's record and catching it.
 * Most callers want the first, so it stays the cheap spelling.
 */
export type DkimSelector =
  | string
  | {
      readonly expectedPublicKey?: string;
      readonly selector: string;
    };

/** The selector name, whichever spelling was used. */
export function dkimSelectorName(selector: DkimSelector): string {
  return typeof selector === "string" ? selector : selector.selector;
}

/**
 * A token the platform minted, and where it goes.
 *
 * No bare-string spelling, unlike `DkimSelector`. There is no weaker question a
 * token can answer — an opaque string is either the one we issued or it is not —
 * so a form that omits the value would be a check with nothing to compare.
 */
export interface OwnershipToken {
  /** The label the token goes at. Omit for the apex. */
  readonly label?: string;
  readonly token: string;
}

/** An alias the platform issued, and the name the customer publishes it at. */
export interface CnameTarget {
  /** Required: RFC 1034 §3.6.2 forbids an alias at a zone apex. */
  readonly label: string;
  readonly target: string;
}

/** How a repeated outcome is keyed back to the requirement that asked for it. */
export function ownershipLabel(token: OwnershipToken): string {
  return token.label ?? "";
}

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
  /** Aliases the platform issued. Empty means no alias is expected here. */
  readonly cnames?: readonly CnameTarget[];
  /** Selectors the platform issued. Empty means DKIM is not expected here. */
  readonly dkimSelectors?: readonly DkimSelector[];
  /**
   * Whether this domain is meant to receive mail.
   *
   * Omit when the caller does not know. Undeliverable mail is only a fault if
   * someone said the domain should receive it.
   */
  readonly expectsMail?: boolean;
  /** Stable identifier, stored alongside the domain and reported in results. */
  readonly id: string;
  /** Tokens the platform minted. Empty means ownership is not asserted here. */
  readonly ownership?: readonly OwnershipToken[];
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
  dkimSelectors?: readonly DkimSelector[];
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
  dkimSelectors?: readonly DkimSelector[];
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
