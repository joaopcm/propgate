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

data?.version;`;

export const PROFILES_PER_DOMAIN = `await propgate.profiles.create({
  key: "sending",
  requirements: [
    {
      key: "dkim",
      check: "dkim",
      selector: "pg1",
      requiredPerDomain: ["expectedPublicKey"],
    },
    { key: "bounce-spf", check: "spf", label: "send", include: "spf.acme.com" },
    { key: "bounce-mx", check: "mx", label: "send", expectsMail: true },
    { key: "apex-mx", check: "mx", expectsMail: false },
  ],
});`;

export const PROFILES_GET = `const { data, error } = await propgate.profiles.get("sending");`;

export const PROFILES_TYPED = `import type { ProfileRequirement } from "@propgate/sdk";

const dmarc: ProfileRequirement = { key: "dmarc", check: "dmarc" };`;
