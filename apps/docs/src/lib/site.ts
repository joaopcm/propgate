/**
 * Canonical URLs and names this site publishes to agents.
 *
 * One module rather than string literals in each route: a typo in the brand
 * name or the API host would pass every page-level test and fail the audit
 * that looks for "propgate" by name.
 */

export const PRODUCT_NAME = "propgate";
export const SITE_NAME = "propgate docs";
export const SITE_URL = "https://docs.propgate.dev";
export const API_URL = "https://api.propgate.dev";
export const PRODUCT_URL = "https://propgate.dev";
export const GITHUB_URL = "https://github.com/joaopcm/propgate";
export const CONTACT_EMAIL = "hello@propgate.dev";

export const SITE_DESCRIPTION =
  "propgate docs: DNS diagnosis taxonomy and API reference. Domain verification that tells you what is wrong, not just that something is.";
