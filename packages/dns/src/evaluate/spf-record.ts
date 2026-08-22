import { isIPv4, isIPv6 } from "node:net";
import { validateMacroString } from "./spf-macro";

export const SPF_QUALIFIERS = ["+", "-", "~", "?"] as const;

export type SpfQualifier = (typeof SPF_QUALIFIERS)[number];

export const SPF_MECHANISMS = [
  "all",
  "include",
  "a",
  "mx",
  "ptr",
  "ip4",
  "ip6",
  "exists",
] as const;

export type SpfMechanismName = (typeof SPF_MECHANISMS)[number];

export interface SpfMechanism {
  readonly kind: "mechanism";
  readonly name: SpfMechanismName;
  readonly prefix4?: number;
  readonly prefix6?: number;
  readonly qualifier: SpfQualifier;
  readonly raw: string;
  readonly value?: string;
}

export interface SpfModifier {
  readonly kind: "modifier";
  readonly name: string;
  readonly raw: string;
  readonly value: string;
}

export type SpfTerm = SpfMechanism | SpfModifier;

export interface SpfRecord {
  readonly all?: SpfMechanism;
  readonly exp?: string;
  readonly raw: string;
  readonly redirect?: string;
  readonly terms: readonly SpfTerm[];
}

export type SpfParse =
  | { readonly ok: true; readonly record: SpfRecord }
  | { readonly ok: false; readonly detail: string; readonly term?: string };

const SPF_VERSION = /^v=spf1(\s|$)/i;
const MODIFIER_NAME = /^[a-z][a-z0-9\-_.]*$/i;
const MACRO = /%\{/;
const DUAL_CIDR = /^(?:\/(\d{1,2}))?(?:\/\/(\d{1,3}))?$/;
const CIDR_LENGTH = /^\d{1,3}$/;
const NAME_SEPARATOR = /[:=]/;
const TRAILING_DUAL_CIDR = /(\/\d{1,2})?(\/\/\d{1,3})?$/;
const WHITESPACE = /\s+/;

export function looksLikeSpf(txt: string): boolean {
  return SPF_VERSION.test(txt.trim());
}

export function containsMacro(value: string): boolean {
  return MACRO.test(value);
}

export function countsAsLookup(term: SpfTerm): boolean {
  if (term.kind === "modifier") {
    return term.name === "redirect";
  }

  return (
    term.name === "include" ||
    term.name === "a" ||
    term.name === "mx" ||
    term.name === "ptr" ||
    term.name === "exists"
  );
}

function parseQualifier(token: string): {
  qualifier: SpfQualifier;
  rest: string;
} {
  const head = token.charAt(0);

  for (const qualifier of SPF_QUALIFIERS) {
    if (head === qualifier) {
      return { qualifier, rest: token.slice(1) };
    }
  }

  return { qualifier: "+", rest: token };
}

function parsePrefixes(
  suffix: string,
  name: SpfMechanismName
): { prefix4?: number; prefix6?: number } | string {
  if (suffix === "") {
    return {};
  }

  const match = DUAL_CIDR.exec(suffix);

  if (!match || (match[1] === undefined && match[2] === undefined)) {
    return `"${suffix}" is not a CIDR length`;
  }

  const prefix4 = match[1] === undefined ? undefined : Number(match[1]);
  const prefix6 = match[2] === undefined ? undefined : Number(match[2]);

  if (prefix4 !== undefined && prefix4 > 32) {
    return `/${prefix4} is not a valid IPv4 prefix length`;
  }

  if (prefix6 !== undefined && prefix6 > 128) {
    return `//${prefix6} is not a valid IPv6 prefix length`;
  }

  if (prefix6 !== undefined && name !== "a" && name !== "mx") {
    return `${name} takes a single CIDR length, not a dual one`;
  }

  return { prefix4, prefix6 };
}

function parseIpMechanism(
  name: "ip4" | "ip6",
  qualifier: SpfQualifier,
  raw: string,
  argument: string
): SpfMechanism | string {
  const slash = argument.indexOf("/");
  const address = slash === -1 ? argument : argument.slice(0, slash);
  const prefixText = slash === -1 ? "" : argument.slice(slash + 1);
  const maximum = name === "ip4" ? 32 : 128;

  if (name === "ip4" ? !isIPv4(address) : !isIPv6(address)) {
    return `"${address}" is not ${name === "ip4" ? "an IPv4" : "an IPv6"} address`;
  }

  if (slash === -1) {
    return {
      kind: "mechanism",
      name,
      qualifier,
      raw,
      value: address,
      ...(name === "ip4" ? { prefix4: 32 } : { prefix6: 128 }),
    };
  }

  if (!CIDR_LENGTH.test(prefixText)) {
    return `"${prefixText}" is not a CIDR length`;
  }

  const prefix = Number(prefixText);

  if (prefix > maximum) {
    return `/${prefix} exceeds the ${maximum}-bit ${name === "ip4" ? "IPv4" : "IPv6"} address`;
  }

  return {
    kind: "mechanism",
    name,
    qualifier,
    raw,
    value: address,
    ...(name === "ip4" ? { prefix4: prefix } : { prefix6: prefix }),
  };
}

function mechanismNameOf(candidate: string): SpfMechanismName | undefined {
  return SPF_MECHANISMS.find((name) => name === candidate);
}

function splitMechanism(body: string): {
  head: string;
  argument: string | undefined;
  suffix: string;
} {
  const separator = body.search(NAME_SEPARATOR);

  if (separator !== -1) {
    return {
      argument: body.slice(separator + 1),
      head: body.slice(0, separator).toLowerCase(),
      suffix: "",
    };
  }

  const slash = body.indexOf("/");

  if (slash === -1) {
    return { argument: undefined, head: body.toLowerCase(), suffix: "" };
  }

  return {
    argument: undefined,
    head: body.slice(0, slash).toLowerCase(),
    suffix: body.slice(slash),
  };
}

function splitDomainSpec(argument: string): {
  domain: string;
  suffix: string;
} {
  const match = TRAILING_DUAL_CIDR.exec(argument);
  const suffix = match?.[0] ?? "";

  return { domain: argument.slice(0, argument.length - suffix.length), suffix };
}

function parseMechanism(token: string): SpfMechanism | string {
  const { qualifier, rest } = parseQualifier(token);

  if (rest === "") {
    return "empty term";
  }

  const parts = splitMechanism(rest);
  const name = mechanismNameOf(parts.head);

  if (name === undefined) {
    return `"${parts.head}" is not an SPF mechanism`;
  }

  if (name === "ip4" || name === "ip6") {
    if (parts.argument === undefined || parts.argument === "") {
      return `${name} needs an address, as in ${name}:${name === "ip4" ? "198.51.100.0/24" : "2001:db8::/32"}`;
    }

    return parseIpMechanism(name, qualifier, token, parts.argument);
  }

  if (name === "include" || name === "exists") {
    if (parts.argument === undefined || parts.argument === "") {
      return `${name} needs a domain, as in ${name}:_spf.example.com`;
    }

    return {
      kind: "mechanism",
      name,
      qualifier,
      raw: token,
      value: parts.argument,
    };
  }

  if (name === "all") {
    if (parts.argument !== undefined || parts.suffix !== "") {
      return "all takes no argument";
    }

    return { kind: "mechanism", name, qualifier, raw: token };
  }

  return parseDomainMechanism(name, qualifier, token, parts);
}

function parseDomainMechanism(
  name: SpfMechanismName,
  qualifier: SpfQualifier,
  token: string,
  parts: { argument: string | undefined; suffix: string }
): SpfMechanism | string {
  const spec =
    parts.argument === undefined
      ? { domain: undefined, suffix: parts.suffix }
      : splitDomainSpec(parts.argument);

  if (name === "ptr" && spec.suffix !== "") {
    return "ptr takes no CIDR length";
  }

  const prefixes = parsePrefixes(spec.suffix, name);

  if (typeof prefixes === "string") {
    return prefixes;
  }

  if (spec.domain === "") {
    return `${name} needs a domain after the colon`;
  }

  return {
    kind: "mechanism",
    name,
    qualifier,
    raw: token,
    ...prefixes,
    ...(spec.domain === undefined ? {} : { value: spec.domain }),
  };
}

function parseModifier(token: string, equals: number): SpfModifier | string {
  const name = token.slice(0, equals).toLowerCase();

  if (!MODIFIER_NAME.test(name)) {
    return `"${name}" is not a valid modifier name`;
  }

  const value = token.slice(equals + 1);

  if ((name === "redirect" || name === "exp") && value === "") {
    return `${name}= needs a domain`;
  }

  return { kind: "modifier", name, raw: token, value };
}

function isModifier(token: string): number {
  const equals = token.indexOf("=");
  const colon = token.indexOf(":");

  if (equals === -1) {
    return -1;
  }

  return colon !== -1 && colon < equals ? -1 : equals;
}

function collectTerm(
  token: string,
  terms: SpfTerm[]
): { detail: string; term: string } | undefined {
  const equals = isModifier(token);
  const parsed =
    equals === -1 ? parseMechanism(token) : parseModifier(token, equals);

  if (typeof parsed === "string") {
    return { detail: parsed, term: token };
  }

  terms.push(parsed);
}

function duplicateModifier(terms: readonly SpfTerm[], name: string): boolean {
  return (
    terms.filter((term) => term.kind === "modifier" && term.name === name)
      .length > 1
  );
}

function firstBadMacro(
  terms: readonly SpfTerm[]
): { detail: string; term: string } | undefined {
  for (const term of terms) {
    const value = macroBearingValue(term);

    if (value === undefined) {
      continue;
    }

    const detail = validateMacroString(value);

    if (detail !== null) {
      return { detail, term: term.raw };
    }
  }
}

function macroBearingValue(term: SpfTerm): string | undefined {
  if (term.kind === "modifier") {
    return term.name === "redirect" || term.name === "exp"
      ? term.value
      : undefined;
  }

  return term.name === "ip4" || term.name === "ip6" ? undefined : term.value;
}

export function parseSpfRecord(raw: string): SpfParse {
  const trimmed = raw.trim();

  if (!looksLikeSpf(trimmed)) {
    return { detail: "does not begin with v=spf1", ok: false };
  }

  const terms: SpfTerm[] = [];

  for (const token of trimmed.split(WHITESPACE).slice(1)) {
    if (token === "") {
      continue;
    }

    const failure = collectTerm(token, terms);

    if (failure) {
      return { detail: failure.detail, ok: false, term: failure.term };
    }
  }

  for (const name of ["redirect", "exp"]) {
    if (duplicateModifier(terms, name)) {
      return { detail: `${name}= appears more than once`, ok: false };
    }
  }

  const badMacro = firstBadMacro(terms);

  if (badMacro) {
    return { detail: badMacro.detail, ok: false, term: badMacro.term };
  }

  const modifierValue = (name: string): string | undefined =>
    terms.find((term) => term.kind === "modifier" && term.name === name)?.value;

  const all = terms.find(
    (term): term is SpfMechanism =>
      term.kind === "mechanism" && term.name === "all"
  );

  return {
    ok: true,
    record: {
      raw: trimmed,
      terms,
      ...(all === undefined ? {} : { all }),
      ...(modifierValue("exp") === undefined
        ? {}
        : { exp: modifierValue("exp") }),
      ...(modifierValue("redirect") === undefined
        ? {}
        : { redirect: modifierValue("redirect") }),
    },
  };
}

export function directLookupCost(record: SpfRecord): number {
  return record.terms.filter(countsAsLookup).length;
}
