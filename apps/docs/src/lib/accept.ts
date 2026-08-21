/**
 * Accept parsing for content negotiation.
 *
 * acceptmarkdown.com forbids substring matching: a Chrome header starts with
 * `text/html` and a naive `startsWith` would work by accident, while
 * `includes("text/markdown")` would also fire on a made-up type. Parse q-values,
 * then pick by quality and specificity (RFC 9110 §12.5.1).
 */

export type NegotiatedType = "html" | "json" | "markdown";

interface Range {
  readonly q: number;
  readonly specificity: number;
  readonly type: string;
}

const TYPE_TOKEN =
  /([a-zA-Z0-9!#$%&'*+.^_`|~-]+)\/([a-zA-Z0-9!#$%&'*+.^_`|~-]+|\*)/;
const Q_VALUE = /(?:^|;)\s*q\s*=\s*(1(?:\.0{0,3})?|0(?:\.\d{0,3})?)/i;

function specificityOf(type: string, subtype: string): number {
  if (type === "*" && subtype === "*") {
    return 0;
  }

  return subtype === "*" ? 1 : 2;
}

function parseRange(part: string): Range | undefined {
  const match = part.trim().match(TYPE_TOKEN);
  const typeToken = match?.[1];
  const subtypeToken = match?.[2];

  if (typeToken === undefined || subtypeToken === undefined) {
    return;
  }

  const type = typeToken.toLowerCase();
  const subtype = subtypeToken.toLowerCase();
  const qMatch = part.match(Q_VALUE);
  const q = qMatch?.[1] === undefined ? 1 : Number(qMatch[1]);

  if (!Number.isFinite(q) || q <= 0) {
    return;
  }

  return {
    q,
    specificity: specificityOf(type, subtype),
    type: `${type}/${subtype}`,
  };
}

export function parseAccept(header: string | null): readonly Range[] {
  if (header === null || header.trim() === "") {
    return [];
  }

  return header
    .split(",")
    .map((part) => parseRange(part))
    .filter((range): range is Range => range !== undefined)
    .toSorted((left, right) => {
      if (right.q !== left.q) {
        return right.q - left.q;
      }

      return right.specificity - left.specificity;
    });
}

function matches(range: Range, candidate: string): boolean {
  if (range.type === "*/*") {
    return true;
  }

  const [type = "", subtype = ""] = range.type.split("/");
  const [candidateType = "", candidateSubtype = ""] = candidate.split("/");

  if (type !== candidateType) {
    return false;
  }

  return subtype === "*" || subtype === candidateSubtype;
}

const OFFERED: readonly {
  readonly kind: NegotiatedType;
  readonly type: string;
}[] = [
  { kind: "markdown", type: "text/markdown" },
  { kind: "html", type: "text/html" },
  { kind: "json", type: "application/json" },
];

/**
 * The representation this request prefers among the ones we can produce.
 *
 * No Accept header is treated as HTML: that is what a browser, curl without
 * `-H`, and every ordinary document request send.
 */
export function negotiateType(
  header: string | null,
  offered: readonly NegotiatedType[] = ["markdown", "html"]
): NegotiatedType | undefined {
  const available = new Set(offered);
  const ranges = parseAccept(header);

  if (ranges.length === 0) {
    return available.has("html") ? "html" : offered[0];
  }

  for (const range of ranges) {
    const match = OFFERED.find(
      (offer) => available.has(offer.kind) && matches(range, offer.type)
    );

    if (match !== undefined) {
      return match.kind;
    }
  }
}

export function prefersMarkdown(header: string | null): boolean {
  return negotiateType(header, ["markdown", "html"]) === "markdown";
}

export function prefersJson(header: string | null): boolean {
  return negotiateType(header, ["json", "html", "markdown"]) === "json";
}
