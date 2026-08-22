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

export type DkimSelector =
  | string
  | {
      readonly expectedPublicKey?: string;
      readonly selector: string;
    };

export function dkimSelectorName(selector: DkimSelector): string {
  return typeof selector === "string" ? selector : selector.selector;
}

export interface OwnershipToken {
  readonly label?: string;
  readonly token: string;
}

export interface CnameTarget {
  readonly label: string;
  readonly target: string;
}

export interface SpfLabel {
  readonly include?: string;
  readonly ip?: string;
  readonly label?: string;
}

export interface MxLabel {
  readonly expectsMail?: boolean;
  readonly label?: string;
}

export function nameAt(label: string | undefined, domain: string): string {
  return label === undefined || label === "" ? domain : `${label}.${domain}`;
}

export function ownershipLabel(token: OwnershipToken): string {
  return token.label ?? "";
}

export interface DomainProfile {
  readonly caaIssuer?: string;
  readonly checks: readonly CheckKind[];
  readonly cnames?: readonly CnameTarget[];
  readonly dkimSelectors?: readonly DkimSelector[];
  readonly id: string;
  readonly mx?: readonly MxLabel[];
  readonly ownership?: readonly OwnershipToken[];
  readonly spf?: readonly SpfLabel[];
}

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
