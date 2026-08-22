import { getPublicSuffix } from "@propgate/dns";

export const MAX_DOMAIN_LENGTH = 253;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TRAILING_DOT = /\.$/;

export function normaliseDomain(domain: string): string {
  return domain.trim().replace(TRAILING_DOT, "").toLowerCase();
}

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
