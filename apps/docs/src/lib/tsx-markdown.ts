import { coverageByRfc, percentage, summary } from "@propgate/dns";
import { SITE_URL } from "./site";
import { allEntries, type Entry, families } from "./taxonomy";
import { EVENT_NAMES, EVENTS, TIMESTAMP_TOLERANCE_SECONDS } from "./webhooks";

/**
 * Markdown for the pages that are `.tsx`, not MDX.
 *
 * Those pages are JSX over a typed registry (taxonomy, conformance, webhooks)
 * so `pageMarkdown` cannot read them. Rebuilding from the same registries the
 * pages render is what stops the agent surface drifting from the HTML.
 */

const SEVERITY_MEANING = {
  error: "Something is wrong and mail or certificates are affected.",
  info: "An observation. Whether it matters depends on what the domain is for.",
  warning: "Working today, and one change away from not working.",
} as const;

function taxonomyCodeBody(entry: Entry): string {
  const { definition, fixtures, unreproducible } = entry;
  let proof = fixtures
    .map((fixture) => `- \`${fixture.zone}\`: ${fixture.reason}`)
    .join("\n");

  if (fixtures.length === 0) {
    proof =
      unreproducible === undefined
        ? "No local fixture is recorded for this code."
        : unreproducible;
  }

  return `# ${definition.code}

${definition.severity}: ${SEVERITY_MEANING[definition.severity]}

${definition.summary}

Source: ${SITE_URL}/taxonomy/${definition.slug}

## Proof

${proof}
`;
}

export function taxonomyIndexMarkdown(): string {
  const sections = families()
    .map((family) => {
      const rows = family.entries
        .map(
          (entry) =>
            `- [${entry.definition.code}](${SITE_URL}/taxonomy/${entry.definition.slug}.md): ${entry.definition.summary}`
        )
        .join("\n");

      return `## ${family.title}\n\n${family.blurb}\n\n${rows}`;
    })
    .join("\n\n");

  return `# Diagnosis taxonomy

Every DNS misconfiguration propgate detects, what it means, and which fixture proves it.

Source: ${SITE_URL}/taxonomy

${sections}
`;
}

export function taxonomyCodeMarkdown(slug: string): string | undefined {
  const entry = allEntries().find(
    (candidate) => candidate.definition.slug === slug
  );

  return entry === undefined ? undefined : taxonomyCodeBody(entry);
}

export function conformanceMarkdown(): string {
  const figures = summary();
  const rfcs = coverageByRfc()
    .map((rfc) => {
      const gaps =
        rfc.gaps.length === 0
          ? "No catalogued gaps."
          : rfc.gaps.map((gap) => `- ${gap.requirement}`).join("\n");

      return `## RFC ${rfc.rfc}: ${rfc.title}`

${rfc.implemented} of ${rfc.applicable} catalogued requirements implemented (${percentage(rfc.implemented, rfc.applicable)}%).

${gaps}`;
    })
    .join("\n\n");

  return `# RFC conformance

Which normative RFC requirements propgate implements, which it does not, and why.

${figures.implemented} implemented, ${figures.gaps.length} not implemented, of ${figures.applicable} applicable requirements.

Source: ${SITE_URL}/conformance

${rfcs}
`;
}

export function webhooksMarkdown(): string {
  const events = EVENT_NAMES.map((event) => {
    const doc = EVENTS[event];

    return `## ${event}

${doc.summary}

Fires ${doc.fires}.`;
  }).join("\n\n");

  return `# Webhook payloads

Receive domain state changes over signed HTTP. Svix-compatible signatures, four events, at-least-once delivery with exponential backoff. Timestamp tolerance is ${TIMESTAMP_TOLERANCE_SECONDS} seconds.

Source: ${SITE_URL}/webhooks

${events}
`;
}
