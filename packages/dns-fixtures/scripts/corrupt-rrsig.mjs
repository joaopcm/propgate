#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const MIN_SIGNATURE_TOKEN = 16;
const CHARS_TO_ROTATE = 4;

function rotate(char) {
  const index = B64.indexOf(char);

  if (index === -1) {
    return char;
  }

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
