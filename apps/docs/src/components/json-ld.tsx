import { homepageJsonLd } from "@/lib/json-ld";

export function JsonLd() {
  return (
    <script
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON-LD must be a raw script body
      dangerouslySetInnerHTML={{ __html: JSON.stringify(homepageJsonLd()) }}
      type="application/ld+json"
    />
  );
}
