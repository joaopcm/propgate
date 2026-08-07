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
 * Kinds a profile may name more than once.
 *
 * Named here rather than inferred at each call site because three places depend
 * on the same fact — the profile, the outcome shape, and the API's rule about
 * which requirements may be written twice — and they must not drift.
 *
 * DKIM repeats per selector; the other four repeat per label, because they are
 * the checks that answer a question about a *name* rather than about the domain
 * as a whole. `delegation`, `dmarc` and `caa` are absent and stay absent: all
 * three are properties of the zone, and asking them at a label either means
 * nothing or asks the same question twice — a subdomain nobody delegated has no
 * NS records, which is a fail no customer can act on.
 */
export const REPEATABLE_CHECK_KINDS = [
  "dkim",
  "ownership",
  "cname",
  "spf",
  "mx",
] as const;

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

/**
 * One SPF question, and the label to ask it at.
 *
 * Named for its discriminator the way `DkimSelector` is, and for the same
 * reason: the label is what tells one of these from its siblings in a profile.
 *
 * `label` is what makes a return-path host expressible. Every sending platform
 * publishes SPF twice — once at the apex, which authorises mail whose From
 * header carries the domain, and once at a bounce host like `send`, which
 * authorises the envelope sender receivers actually check for SPF alignment.
 * They are the same check kind asking about different names, so one profile has
 * to be able to hold both.
 */
export interface SpfLabel {
  /** The `include:` token the platform publishes, if authorisation matters. */
  readonly include?: string;
  /** A specific sending address to evaluate against. */
  readonly ip?: string;
  /** The label to evaluate at, e.g. `send`. Omit for the apex. */
  readonly label?: string;
}

/** One MX question, and the label to ask it at. */
export interface MxLabel {
  /**
   * Whether this name is meant to receive mail.
   *
   * Omit when the caller does not know. Undeliverable mail is only a fault if
   * someone said the name should receive it — and on a send-only apex the
   * honest answer is `false`, while on the bounce host beneath it, it is `true`.
   */
  readonly expectsMail?: boolean;
  /** The label to evaluate at, e.g. `send`. Omit for the apex. */
  readonly label?: string;
}

/**
 * The name a labelled check evaluates, which is the whole of what a label does.
 *
 * One function rather than a template literal at four call sites, because the
 * empty string and `undefined` both mean the apex and a missed case appends a
 * bare dot — producing `.example.com`, an NXDOMAIN, and a failure the customer
 * cannot act on.
 */
export function nameAt(label: string | undefined, domain: string): string {
  return label === undefined || label === "" ? domain : `${label}.${domain}`;
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
  /** Stable identifier, stored alongside the domain and reported in results. */
  readonly id: string;
  /**
   * The names to evaluate MX at. Empty asks the apex and asserts nothing.
   *
   * Repeatable because the two questions a sending platform asks are opposite
   * and both true: the apex of a send-only domain must have no deliverable MX,
   * and the bounce host hanging off it must have one.
   */
  readonly mx?: readonly MxLabel[];
  /** Tokens the platform minted. Empty means ownership is not asserted here. */
  readonly ownership?: readonly OwnershipToken[];
  /** The names to evaluate SPF at. Empty asks the apex with no include. */
  readonly spf?: readonly SpfLabel[];
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
    id: "sending-only",
    mx: [{ expectsMail: false }],
    ...(options.dkimSelectors === undefined
      ? {}
      : { dkimSelectors: options.dkimSelectors }),
    ...(options.spfInclude === undefined
      ? {}
      : { spf: [{ include: options.spfInclude }] }),
  };
}

/** A domain that both sends and receives. */
export function fullMail(options: {
  dkimSelectors?: readonly DkimSelector[];
  spfInclude?: string;
}): DomainProfile {
  return {
    ...sendingOnly(options),
    id: "full-mail",
    mx: [{ expectsMail: true }],
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
    id: "web-only",
    ...(options.caaIssuer === undefined
      ? {}
      : { caaIssuer: options.caaIssuer }),
  };
}
