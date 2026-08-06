/**
 * Ranking, with no filesystem and no React.
 *
 * The index is built at build time by `search-index.ts`, which reads `page.mdx`
 * files off disk; this file only scores what it is handed. Keeping the two apart
 * is what stops `node:fs` following a type import into the client bundle, and it
 * is why every ranking case below can be a plain unit test with a literal index
 * rather than a fixture of the whole docs tree.
 *
 * Both halves share `SearchRecord`, which lives here because this is the side
 * the browser imports.
 */

export interface SearchRecord {
  /** The nav group, where the section has them: "Domains". */
  readonly group?: string;
  /** "#hysteresis-how-many-failures-it-takes-to-believe-one", when a section. */
  readonly hash?: string;
  /** The `h2`/`h3` this record came from. Absent for a page's opening text. */
  readonly heading?: string;
  readonly href: string;
  readonly section: string;
  /** Prose, already stripped of markdown, JSX and code fences. */
  readonly text: string;
  readonly title: string;
}

export interface SearchResult {
  readonly group?: string;
  readonly heading?: string;
  /** The record's `href` with its `hash` already appended. */
  readonly href: string;
  readonly score: number;
  readonly section: string;
  readonly snippet: string;
  readonly title: string;
}

const MAX_RESULTS = 8;
const SNIPPET_LENGTH = 120;
const WHITESPACE = /\s+/;

/**
 * Weights, in the order they matter.
 *
 * A diagnosis code is the query this feature exists for — someone pastes
 * `SPF_TOO_MANY_LOOKUPS` out of an API response — and the code is the record's
 * whole title, so an exact title hit has to outrank any amount of prose that
 * merely mentions it. The gap between 100 and 10 is the point: a page *about*
 * the thing beats fifty pages that reference it.
 */
const TITLE_EXACT = 100;
const TITLE_PREFIX = 60;
const TITLE_SUBSTRING = 40;
const HEADING_SUBSTRING = 25;
const TEXT_SUBSTRING = 10;

interface Scored {
  readonly order: number;
  readonly record: SearchRecord;
  readonly score: number;
}

export function tokenize(query: string): string[] {
  return query.toLowerCase().split(WHITESPACE).filter(Boolean);
}

function scoreToken(record: SearchRecord, token: string): number {
  const title = record.title.toLowerCase();
  let score = 0;

  if (title === token) {
    score += TITLE_EXACT;
  } else if (title.startsWith(token)) {
    score += TITLE_PREFIX;
  } else if (title.includes(token)) {
    score += TITLE_SUBSTRING;
  }

  if (record.heading?.toLowerCase().includes(token)) {
    score += HEADING_SUBSTRING;
  }

  if (record.text.toLowerCase().includes(token)) {
    score += TEXT_SUBSTRING;
  }

  return score;
}

/**
 * Every token has to land somewhere, or the record is out.
 *
 * OR-matching turns a two-word query into a list of everything that mentions
 * the commoner word, which reads as the search being broken rather than as it
 * being generous.
 */
function scoreRecord(record: SearchRecord, tokens: string[]): number {
  let total = 0;

  for (const token of tokens) {
    const score = scoreToken(record, token);

    if (score === 0) {
      return 0;
    }

    total += score;
  }

  return total;
}

function snippetFor(record: SearchRecord, tokens: string[]): string {
  const { text } = record;
  const lowered = text.toLowerCase();
  const positions = tokens
    .map((token) => lowered.indexOf(token))
    .filter((index) => index !== -1);

  if (text.length <= SNIPPET_LENGTH) {
    return text;
  }

  const first = positions.length === 0 ? 0 : Math.min(...positions);
  const start = Math.max(0, first - Math.floor(SNIPPET_LENGTH / 3));
  const end = Math.min(text.length, start + SNIPPET_LENGTH);
  const body = text.slice(start, end).trim();

  return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * Collapse to one result per destination.
 *
 * Records are finer-grained than destinations: the four webhook events all
 * anchor at `/webhooks#events`, and returning the same link four times spends
 * the whole menu on one section.
 */
function bestPerDestination(scored: Scored[]): Scored[] {
  const best = new Map<string, Scored>();

  for (const candidate of scored) {
    const key = `${candidate.record.href}${candidate.record.hash ?? ""}`;
    const incumbent = best.get(key);

    if (incumbent === undefined || candidate.score > incumbent.score) {
      best.set(key, candidate);
    }
  }

  return [...best.values()];
}

export function search(
  index: readonly SearchRecord[],
  query: string
): SearchResult[] {
  const tokens = tokenize(query);

  if (tokens.length === 0) {
    return [];
  }

  const scored: Scored[] = [];

  for (const [order, record] of index.entries()) {
    const score = scoreRecord(record, tokens);

    if (score > 0) {
      scored.push({ order, record, score });
    }
  }

  return (
    bestPerDestination(scored)
      // Ties break on index order, which is navigation order — the sidebar's
      // reading order is the closest thing to an editorial ranking we have.
      .sort((a, b) => b.score - a.score || a.order - b.order)
      .slice(0, MAX_RESULTS)
      .map(({ record, score }) => ({
        group: record.group,
        heading: record.heading,
        href: `${record.href}${record.hash ?? ""}`,
        score,
        section: record.section,
        snippet: snippetFor(record, tokens),
        title: record.title,
      }))
  );
}
