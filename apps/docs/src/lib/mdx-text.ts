/**
 * Reading an `.mdx` page as prose.
 *
 * The search index needs what a reader sees, and an MDX page is not that: it
 * opens with imports, sometimes declares a constant, and interleaves JSX with
 * the markdown. Everything here exists to get from the file on disk to the
 * sentences on the screen.
 *
 * Tags are scanned rather than matched with a regex, and the reason is on the
 * page: `<EndpointHeader cliCommand="propgate domains list [--state <state>]" …>`
 * carries a `>` inside a quoted attribute, so `<[A-Z][^>]*>` ends the tag in the
 * middle of it and spills the rest into the index as garbage. The same goes for
 * `{…}` — `<ParamsTable rows={[{ … }, { … }]} />` needs balanced braces, not a
 * lazy match to the first `}`. Both are a dozen lines of scanner and neither is
 * a regex that can be made correct.
 *
 * Children are kept, attributes are not: a `<Callout>` body is prose a reader
 * reads and frequently the most quotable line on the page, while `kind="warning"`
 * and `lang="json"` are the kind of noise that makes every API page match a
 * search for "json".
 *
 * `EndpointHeader` is the one exception, and it earns it. Its attributes are the
 * method, the path and the CLI command — the three things printed largest on an
 * endpoint page and the likeliest thing anyone types into a search box on a
 * reference site. Dropping them leaves twenty pages findable by their prose and
 * not by `/v1/domains`.
 */

export interface MdxSection {
  /** The `h2`/`h3` this text sits under. Absent for a page's opening text. */
  readonly heading?: string;
  readonly text: string;
}

export interface MdxPage {
  readonly sections: readonly MdxSection[];
  /** The `h1`. Absent only if a page never writes one. */
  readonly title: string | undefined;
}

const QUOTES = new Set(['"', "'", "`"]);
const FENCE = /^\s*```/;
const ESM_STATEMENT = /^(?:import|export)\s/;
const HEADING = /^(#{1,3})\s+(.+)$/;
const TABLE_DELIMITER_ROW = /^[ \t]*(?:\|[ \t:|-]*|-{3,})[ \t]*$/gm;
const IMAGE = /!\[([^\]]*)\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const BACKTICK = /`/g;
const EMPHASIS = /\*+/g;
const BLOCKQUOTE = /^[ \t]{0,3}>[ \t]?/gm;
const BULLET = /^[ \t]*[-+][ \t]+/gm;
const ORDERED = /^[ \t]*\d+\.[ \t]+/gm;
const PIPE = /\|/g;
const WHITESPACE = /\s+/g;
const TAG_NAME_START = /[A-Za-z]/;
const TAG_NAME = /^<\/?([A-Za-z][\w.]*)/;
const QUOTED_VALUE = /"([^"]*)"/g;
const CONTENTFUL_TAGS = new Set(["EndpointHeader"]);

function skipQuoted(source: string, start: number): number {
  const quote = source.charAt(start);
  let index = start + 1;

  while (index < source.length) {
    const char = source.charAt(index);

    if (char === "\\") {
      index += 2;
      continue;
    }

    if (char === quote) {
      return index + 1;
    }

    index += 1;
  }

  return index;
}

/** From the opening `{` to just past its matching `}`. */
function skipBraces(source: string, start: number): number {
  let depth = 0;
  let index = start;

  while (index < source.length) {
    const char = source.charAt(index);

    if (QUOTES.has(char)) {
      index = skipQuoted(source, index);
      continue;
    }

    if (char === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      index += 1;

      if (depth === 0) {
        return index;
      }

      continue;
    }

    index += 1;
  }

  return index;
}

/** From the opening `<` to just past the `>` that closes the same tag. */
function skipTag(source: string, start: number): number {
  let index = start + 1;

  while (index < source.length) {
    const char = source.charAt(index);

    if (QUOTES.has(char)) {
      index = skipQuoted(source, index);
      continue;
    }

    if (char === "{") {
      index = skipBraces(source, index);
      continue;
    }

    if (char === ">") {
      return index + 1;
    }

    index += 1;
  }

  return index;
}

/**
 * A `<` only opens a tag when a name or a slash follows it. MDX would refuse to
 * compile a bare `<` in prose, so in practice this is every `<` in the file —
 * but reading the next character is cheaper than relying on that.
 */
function isTagStart(source: string, index: number): boolean {
  const next = source.charAt(index + 1);

  return next === "/" || TAG_NAME_START.test(next);
}

function stripFences(source: string): string {
  const kept: string[] = [];
  let inFence = false;

  for (const line of source.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (!inFence) {
      kept.push(line);
    }
  }

  return kept.join("\n");
}

function braceDelta(line: string): number {
  let delta = 0;
  let index = 0;

  while (index < line.length) {
    const char = line.charAt(index);

    if (QUOTES.has(char)) {
      index = skipQuoted(line, index);
      continue;
    }

    if (char === "{") {
      delta += 1;
    } else if (char === "}") {
      delta -= 1;
    }

    index += 1;
  }

  return delta;
}

/**
 * Drop `import` and `export` statements, however many lines they run to.
 *
 * `api/page.mdx` declares an `export const METHOD_STYLE = { … }` across seven
 * lines, so this cannot be a per-line filter. A statement ends at the line where
 * its braces balance again.
 */
function stripEsm(source: string): string {
  const kept: string[] = [];
  let depth = 0;
  let inStatement = false;

  for (const line of source.split("\n")) {
    if (!inStatement && ESM_STATEMENT.test(line)) {
      inStatement = true;
      depth = 0;
    }

    if (!inStatement) {
      kept.push(line);
      continue;
    }

    depth += braceDelta(line);

    if (depth <= 0) {
      inStatement = false;
      depth = 0;
    }
  }

  return kept.join("\n");
}

/** The attribute values worth keeping, for the one tag whose are. */
function contentOfTag(tag: string): string {
  const name = tag.match(TAG_NAME)?.[1];

  if (name === undefined || !CONTENTFUL_TAGS.has(name)) {
    return "";
  }

  const values = [...tag.matchAll(QUOTED_VALUE)].map(([, value]) => value);

  return values.length === 0 ? "" : `${values.join(" ")} `;
}

function stripJsx(source: string): string {
  let output = "";
  let index = 0;

  while (index < source.length) {
    const char = source.charAt(index);

    if (char === "<" && isTagStart(source, index)) {
      const end = skipTag(source, index);

      output += contentOfTag(source.slice(index, end));
      index = end;
      continue;
    }

    if (char === "{") {
      index = skipBraces(source, index);
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

/**
 * Markdown syntax off, words left.
 *
 * `_` is deliberately not treated as emphasis: this corpus is full of
 * `next_check_at` and `previous_state`, and stripping underscores would turn
 * every one of them into a token nobody will ever type.
 */
export function unwrapMarkdown(text: string): string {
  return text
    .replace(TABLE_DELIMITER_ROW, "")
    .replace(IMAGE, "$1")
    .replace(LINK, "$1")
    .replace(BACKTICK, "")
    .replace(EMPHASIS, "")
    .replace(BLOCKQUOTE, "")
    .replace(BULLET, "")
    .replace(ORDERED, "")
    .replace(PIPE, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

export function extractMdx(source: string): MdxPage {
  const body = stripJsx(stripEsm(stripFences(source)));
  const sections: MdxSection[] = [];
  let title: string | undefined;
  let heading: string | undefined;
  let buffer: string[] = [];

  function flush(): void {
    const text = unwrapMarkdown(buffer.join("\n"));
    buffer = [];

    if (text === "") {
      return;
    }

    sections.push(heading === undefined ? { text } : { heading, text });
  }

  for (const line of body.split("\n")) {
    const match = line.match(HEADING);

    if (match === null) {
      buffer.push(line);
      continue;
    }

    const [, hashes = "", raw = ""] = match;

    if (hashes.length === 1) {
      title = unwrapMarkdown(raw);
      continue;
    }

    flush();
    heading = unwrapMarkdown(raw);
  }

  flush();

  return { sections, title };
}
