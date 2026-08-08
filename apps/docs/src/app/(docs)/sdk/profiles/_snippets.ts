/**
 * Profiles, from Node.
 *
 * The requirement shapes mirror `/api/profiles/create`, so the two pages cannot
 * describe different profiles. `src/lib/sdk.spec.ts` checks the method names
 * against `@propgate/sdk`.
 */

export const PROFILES_CREATE = `const { data, error } = await propgate.profiles.create({
  key: "sending",
  requirements: [
    { key: "ns", check: "delegation" },
    { key: "spf", check: "spf", include: "_spf.google.com" },
    { key: "dkim", check: "dkim", selector: "google" },
    { key: "dmarc", check: "dmarc" },
    { key: "mail", check: "mx", expectsMail: true },
  ],
});

data?.version; // 1 the first time, 2 the next time you write this key`;

export const PROFILES_PER_DOMAIN = `await propgate.profiles.create({
  key: "sending",
  requirements: [
    {
      key: "dkim",
      check: "dkim",
      selector: "pg1",
      // The value is issued per customer, so the domain supplies it.
      requiredPerDomain: ["expectedPublicKey"],
    },
    // Two names, one profile: SPF and MX at a bounce host beneath the domain.
    { key: "bounce-spf", check: "spf", label: "send", include: "spf.acme.com" },
    { key: "bounce-mx", check: "mx", label: "send", expectsMail: true },
    { key: "apex-mx", check: "mx", expectsMail: false },
  ],
});`;

export const PROFILES_GET = `const { data, error } = await propgate.profiles.get("sending");

if (error?.code === "not_found") {
  // No profile by that key on this account.
}`;

export const PROFILES_TYPED = `import type { ProfileRequirement } from "@propgate/sdk";

// \`check\` is the same union the evaluators use, so a typo is a compile error
// rather than a 422 you find at runtime.
const dmarc: ProfileRequirement = { key: "dmarc", check: "dmarc" };`;
