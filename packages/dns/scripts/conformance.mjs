#!/usr/bin/env node
/**
 * Renders the RFC conformance table into README.md, between two markers.
 *
 * A generated block inside a hand-written file, checked rather than trusted:
 * `--check` exits non-zero when the file has drifted, which is what makes the
 * table in the README a fact about the current build rather than a snapshot of
 * whenever someone last remembered to update it.
 *
 * Run through tsx rather than plain node: the ledger is TypeScript and this
 * codebase imports without file extensions, which Node's ESM resolver will not
 * do. Same shape as `generate-psl.mjs` otherwise — run without arguments to
 * write, with `--check` to verify.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  coverageByRfc,
  percentage,
  summary,
} from "../src/conformance/summary.ts";

const REPO_ROOT = dirname(
  dirname(dirname(dirname(fileURLToPath(import.meta.url))))
);
const README = join(REPO_ROOT, "README.md");
const START = "<!-- conformance:start -->";
const END = "<!-- conformance:end -->";

function render() {
  const totals = summary();
  const rows = coverageByRfc().map((rfc) => {
    const share = percentage(rfc.implemented, rfc.applicable);

    return `| [RFC ${rfc.rfc}](https://www.rfc-editor.org/rfc/rfc${rfc.rfc}) | ${rfc.title} | ${rfc.implemented} / ${rfc.applicable} | ${share}% |`;
  });

  const gaps = totals.gaps.map(
    (gap) =>
      `- **RFC ${gap.rfc} §${gap.section}** — ${gap.requirement}. ${gap.note}`
  );

  return [
    START,
    "",
    `**${totals.implemented} of ${totals.applicable} catalogued requirements** (${percentage(totals.implemented, totals.applicable)}%).`,
    "",
    "| RFC | | Implemented | |",
    "| --- | --- | --- | --- |",
    ...rows,
    "",
    "The denominator is our reading of which normative statements apply to a",
    "verifier — something that inspects a domain's records and reports on them.",
    "It is not a percentage of an RFC's text, which is not a computable number:",
    "most of RFC 7208 instructs senders and receiving MTAs, and none of that is",
    "ours to implement. Requirements that do not apply are listed in the ledger",
    "with a reason and excluded from the denominator, so cataloguing more of what",
    "an MTA does cannot improve the figure.",
    "",
    "Every requirement marked implemented names a test that must exist and must",
    "assert it; `conformance.spec.ts` fails the build otherwise. The table is",
    "generated from that ledger and CI rejects the README if it has drifted.",
    "",
    "### What we do not do",
    "",
    ...gaps,
    "",
    END,
  ].join("\n");
}

const readme = readFileSync(README, "utf8");
const from = readme.indexOf(START);
const to = readme.indexOf(END);

if (from === -1 || to === -1) {
  process.stderr.write(
    `conformance: README.md is missing the ${START} / ${END} markers\n`
  );
  process.exit(1);
}

const updated =
  readme.slice(0, from) + render() + readme.slice(to + END.length);

if (process.argv.includes("--check")) {
  if (updated !== readme) {
    process.stderr.write(
      "conformance: README.md is out of date — run `pnpm conformance`\n"
    );
    process.exit(1);
  }

  process.stdout.write("conformance: README.md matches the ledger\n");
  process.exit(0);
}

writeFileSync(README, updated);
process.stdout.write("conformance: README.md updated\n");
