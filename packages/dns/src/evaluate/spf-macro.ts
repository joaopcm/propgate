import type { IpAddress } from "./spf-ip";

const DEFAULT_DELIMITER = ".";
const MAX_DOMAIN_LENGTH = 253;

const DOMAIN_LETTERS = "slodiphv";
const EXP_ONLY_LETTERS = "crt";

export interface MacroContext {
  readonly domain: string;
  readonly helo?: string;
  readonly ip?: IpAddress;
  readonly sender?: string;
}

export type MacroExpansion =
  | { readonly ok: true; readonly value: string }
  | {
      readonly ok: false;
      readonly reason: "syntax" | "unsupported";
      readonly detail: string;
    };

interface MacroToken {
  readonly delimiters: string;
  readonly digits: number | undefined;
  readonly kind: "macro";
  readonly letter: string;
  readonly reverse: boolean;
  readonly urlEscape: boolean;
}

type Token = { readonly kind: "literal"; readonly text: string } | MacroToken;

type Tokenized =
  | { readonly ok: true; readonly tokens: readonly Token[] }
  | { readonly ok: false; readonly detail: string };

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
      return;
  }
}

function ipMacro(ip: IpAddress): string {
  return ip.family === "ipv4"
    ? ip.text.replace(V4_MAPPED_TEXT, "")
    : dottedNibbles(ip.bytes);
}

function ipVersionMacro(ip: IpAddress): string {
  return ip.family === "ipv4" ? "in-addr" : "ip6";
}

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
