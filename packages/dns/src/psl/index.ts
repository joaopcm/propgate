import { domainToASCII } from "node:url";
import {
  ICANN_EXCEPTIONS,
  ICANN_LITERALS,
  ICANN_WILDCARDS,
  PRIVATE_EXCEPTIONS,
  PRIVATE_LITERALS,
  PRIVATE_WILDCARDS,
} from "./data";

export interface PslOptions {
  readonly includePrivate?: boolean;
}

interface RuleSets {
  readonly exceptions: ReadonlySet<string>;
  readonly literals: ReadonlySet<string>;
  readonly wildcards: ReadonlySet<string>;
}

function buildRuleSets(includePrivate: boolean): RuleSets {
  if (!includePrivate) {
    return {
      exceptions: new Set(ICANN_EXCEPTIONS),
      literals: new Set(ICANN_LITERALS),
      wildcards: new Set(ICANN_WILDCARDS),
    };
  }

  return {
    exceptions: new Set([...ICANN_EXCEPTIONS, ...PRIVATE_EXCEPTIONS]),
    literals: new Set([...ICANN_LITERALS, ...PRIVATE_LITERALS]),
    wildcards: new Set([...ICANN_WILDCARDS, ...PRIVATE_WILDCARDS]),
  };
}

const WITH_PRIVATE = buildRuleSets(true);
const ICANN_ONLY = buildRuleSets(false);

function ruleSetsFor(options: PslOptions | undefined): RuleSets {
  return options?.includePrivate === false ? ICANN_ONLY : WITH_PRIVATE;
}

const ASCII_LABEL = /^[a-z0-9-]+$/;

interface NormalisedName {
  readonly ascii: readonly string[];
  readonly original: readonly string[];
}

function normalise(input: string): NormalisedName | null {
  if (input.length === 0) {
    return null;
  }

  const trimmed = input.endsWith(".") ? input.slice(0, -1) : input;

  if (trimmed.length === 0) {
    return null;
  }

  const original = trimmed.toLowerCase().split(".");

  if (original.some((label) => label.length === 0)) {
    return null;
  }

  const ascii: string[] = [];

  for (const label of original) {
    if (ASCII_LABEL.test(label)) {
      ascii.push(label);
      continue;
    }

    const converted = domainToASCII(label);

    if (converted === "") {
      return null;
    }

    ascii.push(converted);
  }

  return { ascii, original };
}

function publicSuffixLabelCount(
  { ascii }: NormalisedName,
  options: PslOptions | undefined
): number {
  const { literals, wildcards, exceptions } = ruleSetsFor(options);

  for (let i = 0; i < ascii.length; i += 1) {
    if (exceptions.has(ascii.slice(i).join("."))) {
      return ascii.length - i - 1;
    }
  }

  for (let i = 0; i < ascii.length; i += 1) {
    if (literals.has(ascii.slice(i).join("."))) {
      return ascii.length - i;
    }

    if (
      ascii.length - i > 1 &&
      wildcards.has(`*.${ascii.slice(i + 1).join(".")}`)
    ) {
      return ascii.length - i;
    }
  }

  return 1;
}

export function getPublicSuffix(
  input: string,
  options?: PslOptions
): string | null {
  const name = normalise(input);

  if (name === null) {
    return null;
  }

  const count = publicSuffixLabelCount(name, options);

  return name.original.slice(name.original.length - count).join(".");
}

export function getRegistrableDomain(
  input: string,
  options?: PslOptions
): string | null {
  const name = normalise(input);

  if (name === null) {
    return null;
  }

  const count = publicSuffixLabelCount(name, options);

  if (name.original.length <= count) {
    return null;
  }

  return name.original.slice(name.original.length - count - 1).join(".");
}

export function isPublicSuffix(input: string, options?: PslOptions): boolean {
  const name = normalise(input);

  if (name === null) {
    return false;
  }

  return name.original.length === publicSuffixLabelCount(name, options);
}
