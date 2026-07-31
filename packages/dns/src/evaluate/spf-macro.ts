import type { IpAddress } from "./spf-ip";

/**
 * SPF macro expansion (RFC 7208 §7).
 *
 * A macro turns one published record into a different name for every
 * connection: `exists:%{ir}.%{v}._spf.%{d}` asks a question about the sending
 * address itself. Until this file existed the evaluator reported those terms as
 * undecidable, which was honest but left the most interesting records unchecked.
 *
 * One tokenizer, two entry points. `validateMacroString` runs in the parser,
 * where a bad macro is a syntax error like any other; `expandMacros` runs in
 * the evaluator, where the same tokens are rendered against a connection. Two
 * implementations of this grammar would disagree eventually, and the way they
 * would disagree is that a record fails to parse but expands fine, or the other
 * way round.
 */

const DEFAULT_DELIMITER = ".";
/** §7.3: a domain-spec longer than this is left-truncated, not rejected. */
const MAX_DOMAIN_LENGTH = 253;

/** Macro letters valid in a domain-spec (§7.2). */
const DOMAIN_LETTERS = "slodiphv";
/** Valid only inside `exp=` text, so a permanent error anywhere else. */
const EXP_ONLY_LETTERS = "crt";

export interface MacroContext {
  /** `%{d}` — the domain whose record is being evaluated right now. */
  readonly domain: string;
  /** `%{h}` — the HELO/EHLO name the client gave. */
  readonly helo?: string;
  /** `%{i}`, `%{v}` — the connecting address. */
  readonly ip?: IpAddress;
  /** `%{s}`, `%{l}`, `%{o}` — the envelope sender, `local@domain`. */
  readonly sender?: string;
}

export type MacroExpansion =
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      /**
       * `syntax` is a permanent error — the record is wrong. `unsupported`
       * means the record is fine and we lack the input, which must stay
       * distinguishable: one is the domain owner's problem and the other is
       * ours.
       */
      readonly reason: "syntax" | "unsupported";
      readonly detail: string;
    };

interface MacroToken {
  readonly delimiters: string;
  readonly digits: number | undefined;
  readonly kind: "macro";
  readonly letter: string;
  readonly reverse: boolean;
  /** An uppercase letter means URL-escape the result. */
  readonly urlEscape: boolean;
}

type Token = { readonly kind: "literal"; readonly text: string } | MacroToken;

type Tokenized =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly detail: string };

/** §7.1: letter, optional digits, optional "r", optional delimiter set. */
const MACRO_BODY = /^([a-zA-Z])(\d*)(r?)([.\-+,/_=]*)\}/;
const UNRESERVED = /[A-Za-z0-9\-._~]/;
const V4_MAPPED_TEXT = /^::ffff:/i;

function readMacro(
  raw: string,
  start: number
): { token: MacroToken; next: number } | string {
  const match = MACRO_BODY.exec(raw.slice(start));

  if (!match) {
    return `"${raw.slice(start - 2)}" is not a valid macro`;
  }

  const [whole, letter = "", digits = "", reverse = "", delimiters = ""] =
    match;

  // §7.1: "the DIGIT ... MUST be non-zero". Zero would ask for no parts at all,
  // which has no meaning and no defined behaviour to fall back on.
  if (digits !== "" && Number(digits) === 0) {
    return `%{${letter}0...} asks for zero parts, which is not a number of parts`;
  }

  return {
    next: start + whole.length,
    token: {
      delimiters: delimiters === "" ? DEFAULT_DELIMITER : delimiters,
      digits: digits === "" ? undefined : Number(digits),
      kind: "macro",
      letter,
      reverse: reverse === "r",
      urlEscape: letter !== letter.toLowerCase(),
    },
  };
}

function tokenize(raw: string): Tokenized {
  const tokens: Token[] = [];
  let literal = "";
  let index = 0;

  const flush = (): void => {
    if (literal !== "") {
      tokens.push({ kind: "literal", text: literal });
      literal = "";
    }
  };

  while (index < raw.length) {
    const character = raw[index] ?? "";

    if (character !== "%") {
      literal += character;
      index += 1;
      continue;
    }

    const next = raw[index + 1];

    if (next === "%") {
      literal += "%";
      index += 2;
      continue;
    }

    if (next === "_") {
      literal += " ";
      index += 2;
      continue;
    }

    if (next === "-") {
      literal += "%20";
      index += 2;
      continue;
    }

    if (next !== "{") {
      // §7.1: a "%" followed by anything else is a syntax error, not a literal
      // percent. Treating it as a literal would silently change what name the
      // record asks about.
      return {
        detail: '"%" must be followed by "{", "%", "_" or "-"',
        ok: false,
      };
    }

    const macro = readMacro(raw, index + 2);

    if (typeof macro === "string") {
      return { detail: macro, ok: false };
    }

    flush();
    tokens.push(macro.token);
    index = macro.next;
  }

  flush();

  return { ok: true, tokens };
}

/**
 * Whether every macro in a domain-spec is well formed.
 *
 * Returns the reason it is not, or null when it is. Used by the parser, so a
 * record carrying a broken macro fails to parse rather than failing later in a
 * way that looks like a DNS problem.
 */
export function validateMacroString(raw: string): string | null {
  const tokenized = tokenize(raw);

  if (!tokenized.ok) {
    return tokenized.detail;
  }

  for (const token of tokenized.tokens) {
    if (token.kind !== "macro") {
      continue;
    }

    const letter = token.letter.toLowerCase();

    if (EXP_ONLY_LETTERS.includes(letter)) {
      return `%{${token.letter}} may only be used in exp= text`;
    }

    if (!DOMAIN_LETTERS.includes(letter)) {
      return `%{${token.letter}} is not an SPF macro letter`;
    }
  }

  return null;
}

/** §7.3 splits on any of the delimiters, not on a single chosen one. */
function splitOn(value: string, delimiters: string): string[] {
  const parts: string[] = [];
  let current = "";

  for (const character of value) {
    if (delimiters.includes(character)) {
      parts.push(current);
      current = "";
      continue;
    }

    current += character;
  }

  parts.push(current);

  return parts;
}

/**
 * §7.3: split, reverse, keep the rightmost N, rejoin with ".".
 *
 * The order matters. `%{d2r}` reverses first and then takes the rightmost two,
 * which for `a.b.c` is `b.a` and not `c.b` — doing it the other way round asks
 * about a name nobody published.
 */
function transform(value: string, token: MacroToken): string {
  const hasTransform =
    token.reverse ||
    token.digits !== undefined ||
    token.delimiters !== DEFAULT_DELIMITER;

  if (!hasTransform) {
    return value;
  }

  let parts = splitOn(value, token.delimiters);

  if (token.reverse) {
    parts = [...parts].reverse();
  }

  if (token.digits !== undefined && token.digits < parts.length) {
    parts = parts.slice(parts.length - token.digits);
  }

  return parts.join(DEFAULT_DELIMITER);
}

/** §7.3 escapes everything outside RFC 3986's unreserved set. */
function urlEscape(value: string): string {
  let escaped = "";

  for (const character of value) {
    escaped += UNRESERVED.test(character)
      ? character
      : `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`;
  }

  return escaped;
}

const HEX_DIGITS = 16;

/** §7.3: IPv6 becomes 32 nibbles, dot-separated, so `r` can reverse them. */
function dottedNibbles(bytes: Uint8Array): string {
  const nibbles: string[] = [];

  for (const byte of bytes) {
    nibbles.push(
      Math.floor(byte / HEX_DIGITS).toString(HEX_DIGITS),
      (byte % HEX_DIGITS).toString(HEX_DIGITS)
    );
  }

  return nibbles.join(DEFAULT_DELIMITER);
}

/**
 * The envelope sender, split.
 *
 * §4.3: a bounce arrives with an empty MAIL FROM, and SPF substitutes
 * `postmaster@<helo>` so the record still has something to talk about.
 */
function senderParts(
  context: MacroContext
): { local: string; domain: string } | undefined {
  const sender = context.sender ?? "";
  const at = sender.lastIndexOf("@");

  if (at > 0 && at < sender.length - 1) {
    return { domain: sender.slice(at + 1), local: sender.slice(0, at) };
  }

  if (context.helo !== undefined && context.helo !== "") {
    return { domain: context.helo, local: "postmaster" };
  }
}

function macroValue(letter: string, context: MacroContext): string | undefined {
  const sender = senderParts(context);

  switch (letter) {
    case "s":
      return sender && `${sender.local}@${sender.domain}`;
    case "l":
      return sender?.local;
    case "o":
      return sender?.domain;
    case "d":
      return context.domain;
    case "h":
      return context.helo;
    case "i":
      return context.ip === undefined ? undefined : ipMacro(context.ip);
    case "v":
      return context.ip === undefined ? undefined : ipVersionMacro(context.ip);
    default:
      // `p` is the validated domain name of the address, which needs a reverse
      // lookup and a forward confirmation of every name it returns. §7.3 says
      // outright not to publish it.
      return;
  }
}

function ipMacro(ip: IpAddress): string {
  // A mapped address is IPv4 as far as SPF is concerned, and %{i} must be the
  // dotted quad — the mapped spelling would ask about a name nobody published.
  return ip.family === "ipv4"
    ? ip.text.replace(V4_MAPPED_TEXT, "")
    : dottedNibbles(ip.bytes);
}

function ipVersionMacro(ip: IpAddress): string {
  return ip.family === "ipv4" ? "in-addr" : "ip6";
}

/**
 * §7.3: an expanded domain-spec over 253 characters loses whole labels from the
 * left until it fits, rather than being rejected.
 */
function truncate(value: string): string {
  if (value.length <= MAX_DOMAIN_LENGTH) {
    return value;
  }

  const labels = value.split(DEFAULT_DELIMITER);

  while (
    labels.length > 1 &&
    labels.join(DEFAULT_DELIMITER).length > MAX_DOMAIN_LENGTH
  ) {
    labels.shift();
  }

  return labels.join(DEFAULT_DELIMITER);
}

export function expandMacros(
  raw: string,
  context: MacroContext
): MacroExpansion {
  const tokenized = tokenize(raw);

  if (!tokenized.ok) {
    return { detail: tokenized.detail, ok: false, reason: "syntax" };
  }

  let expanded = "";

  for (const token of tokenized.tokens) {
    if (token.kind === "literal") {
      expanded += token.text;
      continue;
    }

    const invalid = validateMacroString(`%{${token.letter}}`);

    if (invalid !== null) {
      return { detail: invalid, ok: false, reason: "syntax" };
    }

    const value = macroValue(token.letter.toLowerCase(), context);

    if (value === undefined) {
      return {
        detail: `%{${token.letter}} needs something this check does not have`,
        ok: false,
        reason: "unsupported",
      };
    }

    const transformed = transform(value, token);

    expanded += token.urlEscape ? urlEscape(transformed) : transformed;
  }

  return { ok: true, value: truncate(expanded) };
}
