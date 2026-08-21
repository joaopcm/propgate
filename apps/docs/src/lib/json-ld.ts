import {
  CONTACT_EMAIL,
  GITHUB_URL,
  PRODUCT_NAME,
  PRODUCT_URL,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
} from "./site";

/**
 * JSON-LD for the homepage.
 *
 * A graph so one script can carry both identities the audit looks for:
 * SoftwareApplication (the product) and Organization (the publisher), with
 * contactPoint so agents can answer "how do I reach propgate".
 */

export function homepageJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@id": `${PRODUCT_URL}/#app`,
        "@type": "SoftwareApplication",
        applicationCategory: "DeveloperApplication",
        description: SITE_DESCRIPTION,
        name: PRODUCT_NAME,
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD",
        },
        sameAs: [GITHUB_URL, SITE_URL],
        url: PRODUCT_URL,
      },
      {
        "@id": `${PRODUCT_URL}/#organization`,
        "@type": "Organization",
        contactPoint: {
          "@type": "ContactPoint",
          contactType: "customer support",
          email: CONTACT_EMAIL,
          url: `${SITE_URL}/contact`,
        },
        description: SITE_DESCRIPTION,
        email: CONTACT_EMAIL,
        name: PRODUCT_NAME,
        sameAs: [GITHUB_URL],
        url: PRODUCT_URL,
      },
      {
        "@id": `${SITE_URL}/#website`,
        "@type": "WebSite",
        description: SITE_DESCRIPTION,
        name: SITE_NAME,
        publisher: { "@id": `${PRODUCT_URL}/#organization` },
        url: SITE_URL,
      },
    ],
  };
}
