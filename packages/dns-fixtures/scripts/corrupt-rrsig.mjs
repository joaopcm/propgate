#!/usr/bin/env node
/**
 * Deterministically corrupt the RRSIGs covering a type in a signed zone file.
 *
 *   node corrupt-rrsig.mjs <zonefile> <covered-type>
 *
 * Rotates four base64 characters inside every matching signature. Length and
 * character set are preserved, so:
 *
 *   - NSD still parses and loads the zone (an authoritative server has no
 *     opinion about whether signatures verify), and
 *   - a validating resolver reports the zone bogus.
 *
 * Corrupting the DNSKEY RRSIGs makes the whole zone bogus, which models a
 * botched key rollover — a more common real-world failure than one bad RRset.
 *
 * Two details that are easy to get wrong, and did bite here:
 *
 *  1. **Every** matching RRSIG must be corrupted. BIND signs the DNSKEY RRset
 *     with the ZSK *and* the KSK, and the DS in the parent points at the KSK.
 *     Corrupting only the first leaves a valid path through the other key and
 *     the zone verifies fine, which is a fixture that silently tests nothing.
 *  2. The header pattern requires a digit after the covered type (the algorithm
 *     number). Without that, an NSEC type bitmap such as
 *     `NSEC next. A NS SOA TXT RRSIG NSEC DNSKEY` can match and the script
 *     mutates a bitmap instead of a signature.
 *
 * Deterministic on purpose: the same input always yields the same output, so
 * re-running `pnpm dns:sign` produces no spurious diff.
 */
import { readFileSync, writeFileSync } from "node:fs";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const MIN_SIGNATURE_TOKEN = 16;
const CHARS_TO_ROTATE = 4;

function rotate(char) {
  const index = B64.indexOf(char);

  if (index === -1) {
    return char;
  }

  // +7 is arbitrary but fixed. Any non-zero shift breaks the signature.
  return B64[(index + 7) % B64.length];
}

function corruptToken(token) {
  return (
    token.slice(0, CHARS_TO_ROTATE).split("").map(rotate).join("") +
    token.slice(CHARS_TO_ROTATE)
  );
}

const [zonePath, coveredType] = process.argv.slice(2);

if (!(zonePath && coveredType)) {
  process.stderr.write("usage: corrupt-rrsig.mjs <zonefile> <covered-type>\n");
  process.exit(64);
}

const lines = readFileSync(zonePath, "utf8").split("\n");
const headerPattern = new RegExp(`\\bRRSIG\\s+${coveredType}\\s+\\d+\\s`);

let corrupted = 0;

for (let i = 0; i < lines.length; i += 1) {
  if (!headerPattern.test(lines[i] ?? "")) {
    continue;
  }

  // dnssec-signzone wraps RRSIG rdata in parentheses across several lines. Walk
  // the continuation lines and mutate the first base64 run; the header line's
  // own long tokens are the signer name and the inception/expiration stamps.
  for (let j = i + 1; j < lines.length; j += 1) {
    const line = lines[j] ?? "";
    const match = line.match(
      new RegExp(`[A-Za-z0-9+/]{${MIN_SIGNATURE_TOKEN},}={0,2}`)
    );

    if (match) {
      lines[j] = line.replace(match[0], corruptToken(match[0]));
      corrupted += 1;
      break;
    }

    if (line.includes(")")) {
      break;
    }
  }
}

if (corrupted === 0) {
  process.stderr.write(
    `corrupt-rrsig: no RRSIG covering ${coveredType} in ${zonePath}\n`
  );
  process.exit(1);
}

writeFileSync(zonePath, lines.join("\n"));
process.stdout.write(
  `corrupt-rrsig: broke ${corrupted} RRSIG(s) covering ${coveredType} in ${zonePath}\n`
);
