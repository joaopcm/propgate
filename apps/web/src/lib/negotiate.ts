export type Representation = "html" | "markdown";

interface Range {
  readonly q: number;
  readonly type: string;
}

function parseAccept(header: string): readonly Range[] {
  return header.split(",").flatMap((part) => {
    const [rawType, ...params] = part.split(";").map((token) => token.trim());

    if (rawType === undefined || rawType === "") {
      return [];
    }

    let q = 1;

    for (const param of params) {
      const [name, value] = param.split("=").map((token) => token.trim());

      if (name === "q" && value !== undefined) {
        const parsed = Number(value);
        q = Number.isFinite(parsed) ? parsed : 0;
      }
    }

    return [{ q, type: rawType.toLowerCase() }];
  });
}

function quality(ranges: readonly Range[], type: string): number {
  let best = 0;
  const [main] = type.split("/");

  for (const range of ranges) {
    if (range.q <= 0) {
      continue;
    }

    const [rangeMain, rangeSub] = range.type.split("/");
    const exact = range.type === type;
    const typeWildcard = rangeMain === main && rangeSub === "*";
    const wildcard = range.type === "*/*";

    if (exact || typeWildcard || wildcard) {
      best = Math.max(best, range.q);
    }
  }

  return best;
}

export function negotiate(accept: string | null): Representation {
  if (accept === null || accept.trim() === "") {
    return "html";
  }

  const ranges = parseAccept(accept);
  const markdown = quality(ranges, "text/markdown");
  const html = quality(ranges, "text/html");

  if (markdown === 0 && html === 0) {
    return "html";
  }

  return markdown > html ? "markdown" : "html";
}

export function markdownAssetPath(pathname: string): string {
  const trimmed =
    pathname.length > 1 && pathname.endsWith("/")
      ? pathname.slice(0, -1)
      : pathname;

  if (trimmed === "/" || trimmed === "") {
    return "/index.md";
  }

  if (trimmed.endsWith(".md")) {
    return trimmed;
  }

  return `${trimmed}.md`;
}

export const VARY_ACCEPT = "Accept, Accept-Encoding";
export const MARKDOWN_CONTENT_TYPE = "text/markdown; charset=utf-8";
