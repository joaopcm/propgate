import { getPublicSuffix } from "@propgate/dns";

/**
 * One spelling of a name, and one answer to whether it can be checked at all.
 *
 * Shared by the public checker and the registration route so the two cannot
 * disagree: a name the checker accepts and the register route rejects would be
 * a support conversation with no good answer.
 */

export const MAX_DOMAIN_LENGTH = 253;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TRAILING_DOT = /\.$/;

export function normaliseDomain(domain: string): string {
  return domain.trim().replace(TRAILING_DOT, "").toLowerCase();
}

/**
 * Why a name cannot be checked, or null.
 *
 * A schema covers the shape; this covers the two things about a domain name
 * that a schema cannot express — that every label is well formed, and that the
 * name is not itself a public suffix. Checking `com` is not a question with an
 * answer, and running six evaluators against it would produce a confident,
 * meaningless report.
 */
export function rejectDomain(domain: string): string | null {
  const name = normaliseDomain(domain);

  if (name.length === 0 || name.length > MAX_DOMAIN_LENGTH) {
    return "domain must be between 1 and 253 characters";
  }

  const labels = name.split(".");

  if (labels.length < 2) {
    return "domain must have at least two labels, as in example.com";
  }

  if (!labels.every((label) => LABEL.test(label))) {
    return `"${domain}" is not a valid domain name`;
  }

  if (getPublicSuffix(name) === name) {
    return `"${name}" is a public suffix, not a domain anyone can configure`;
  }

  return null;
}
