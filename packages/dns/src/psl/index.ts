import { domainToASCII } from "node:url";
import {
  ICANN_EXCEPTIONS,
  ICANN_LITERALS,
  ICANN_WILDCARDS,
  PRIVATE_EXCEPTIONS,
  PRIVATE_LITERALS,
  PRIVATE_WILDCARDS,
} from "./data";

/**
 * Public Suffix List lookups.
 *
 * Three things depend on this and get it wrong in characteristic ways:
 *
 *  - **DMARC** is only valid at the organizational domain (PSL+1). A resolver
 *    that reads `_dmarc.sub.example.co.uk` instead of `_dmarc.example.co.uk`
 *    finds nothing and reports a domain as unprotected when it is not.
 *  - **CAA tree climbing** must stop at the organizational domain rather than
 *    walking to `co.uk`, where it would read a policy belonging to nobody.
 *  - **"Is this the apex"** is unanswerable by counting labels.
 *
 * Implements the algorithm from https://publicsuffix.org/list/ and is checked
 * against that project's own test vectors in `psl.spec.ts`.
 */

export interface PslOptions {
  /**
   * Include the PRIVATE DOMAINS section. Defaults to **true**.
   *
   * This flag decides real answers, so it is worth being explicit about. The PSL
   * has two sections: ICANN (actual registry suffixes) and PRIVATE (suffixes
   * where one operator hands out subdomains — `github.io`, `s3.amazonaws.com`,
   * `vercel.app`).
   *
   * With private rules included, `user.github.io` is an organizational domain
   * and its sibling `other.github.io` is a different one — which is what DMARC
   * alignment needs, and what every mail implementation does in practice.
   *
   * With them excluded, `github.io` collapses to `io` and both siblings share an
   * organizational domain. That is the right answer for a question about who
   * registered a name, and the wrong answer for a question about who controls
   * one. We care about control, hence the default.
   */
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

// Built once per configuration rather than per query. There are only two, and
// the union copies ~10k strings, which is not something to redo per lookup.
const WITH_PRIVATE = buildRuleSets(true);
const ICANN_ONLY = buildRuleSets(false);

function ruleSetsFor(options: PslOptions | undefined): RuleSets {
  return options?.includePrivate === false ? ICANN_ONLY : WITH_PRIVATE;
}

const ASCII_LABEL = /^[a-z0-9-]+$/;

interface NormalisedName {
  /** ASCII labels, used for matching against the punycoded rules. */
  readonly ascii: readonly string[];
  /**
   * Labels as the caller wrote them, lowercased with any trailing dot removed.
   *
   * Results are sliced from these rather than from the ASCII form, so a unicode
   * input yields a unicode answer. That is what the PSL project's own test
   * vectors require, and it is what a customer wants to read in a diagnosis —
   * their domain, not its punycode. Callers issuing DNS queries with the result
   * should convert it with `domainToASCII` from node:url.
   */
  readonly original: readonly string[];
}

/**
 * Lowercase, strip one trailing dot, and produce both label forms.
 *
 * Returns null for input that cannot be a domain name. A leading dot or an empty
 * label is rejected rather than normalised away: `.com` and `a..b` are malformed,
 * and quietly repairing them would hide a caller's bug.
 */
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

/**
 * How many trailing labels form the public suffix.
 *
 * A count rather than a string, so the two public functions can slice whichever
 * label form they need without re-normalising or re-parsing.
 */
function publicSuffixLabelCount(
  { ascii }: NormalisedName,
  options: PslOptions | undefined
): number {
  const { literals, wildcards, exceptions } = ruleSetsFor(options);

  // Exceptions beat every other rule regardless of length, so they get their own
  // pass. The first (longest) match wins, and its public suffix is the rule minus
  // its leftmost label.
  for (let i = 0; i < ascii.length; i += 1) {
    if (exceptions.has(ascii.slice(i).join("."))) {
      return ascii.length - i - 1;
    }
  }

  // Among non-exception rules the longest match wins, so walk from the longest
  // candidate suffix and stop at the first hit.
  for (let i = 0; i < ascii.length; i += 1) {
    if (literals.has(ascii.slice(i).join("."))) {
      return ascii.length - i;
    }

    // A wildcard matches one label in that position: "*.ck" matches "foo.ck".
    if (
      ascii.length - i > 1 &&
      wildcards.has(`*.${ascii.slice(i + 1).join(".")}`)
    ) {
      return ascii.length - i;
    }
  }

  // The implicit "*" rule: the rightmost label.
  return 1;
}

/**
 * The public suffix of a name — the part under which names are registered.
 *
 * Returns null for malformed input. Per the algorithm, a name with no matching
 * rule falls back to the implicit `*` rule, so an unlisted TLD is its own public
 * suffix: `getPublicSuffix("example.example")` is `"example"`.
 */
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

/**
 * The organizational domain — the public suffix plus one more label. PSL+1.
 *
 * Returns null when the name has no label beyond its public suffix, because
 * there is then nothing registrable: `getRegistrableDomain("com")` is null, and
 * so is `getRegistrableDomain("ck")` under the `*.ck` wildcard.
 *
 * This is the function DMARC needs, and the one CAA climbing must stop at.
 */
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

/** Whether the name is exactly a public suffix, with nothing registrable under it. */
export function isPublicSuffix(input: string, options?: PslOptions): boolean {
  const name = normalise(input);

  if (name === null) {
    return false;
  }

  return name.original.length === publicSuffixLabelCount(name, options);
}
