export interface SearchRecord {
  readonly group?: string;
  readonly hash?: string;
  readonly heading?: string;
  readonly href: string;
  readonly section: string;
  readonly text: string;
  readonly title: string;
}

export interface SearchResult {
  readonly group?: string;
  readonly heading?: string;
  readonly href: string;
  readonly score: number;
  readonly section: string;
  readonly snippet: string;
  readonly title: string;
}

const MAX_RESULTS = 8;
const SNIPPET_LENGTH = 120;
const WHITESPACE = /\s+/;

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

export function moveActive(
  current: number,
  delta: number,
  count: number
): number {
  return Math.max(0, Math.min(current + delta, count - 1));
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

  return bestPerDestination(scored)
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
    }));
}
