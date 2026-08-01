import {
  type CheckResult,
  DIAGNOSIS_REGISTRY,
  type DiagnosisCode,
  type Finding,
  type Verdict,
} from "@propgate/dns";

/**
 * Turning a result into something a terminal can show.
 *
 * Pure: takes a result, returns lines. The process writes them. That split is
 * what makes the output testable without a fixture tier, and the formatting is
 * where a CLI is usually least tested and most often wrong.
 */

const RESET = "\u001B[0m";

/** Written as escapes rather than literal bytes, so the file stays readable. */
const COLOURS = {
  dim: "\u001B[2m",
  green: "\u001B[32m",
  red: "\u001B[31m",
  yellow: "\u001B[33m",
} as const;

const VERDICT_COLOUR: Readonly<Record<Verdict, keyof typeof COLOURS>> = {
  fail: "red",
  indeterminate: "dim",
  pass: "green",
  warn: "yellow",
};

/**
 * Right-aligned in two columns, so the check names line up whatever the mark.
 *
 * `?` is neither a cross nor a tick on purpose: the check did not run, and
 * every other surface here goes out of its way to keep that separate from a
 * failure.
 */
const VERDICT_MARK: Readonly<Record<Verdict, string>> = {
  fail: " x",
  indeterminate: " ?",
  pass: "ok",
  warn: " !",
};

export interface Style {
  /** Colour is off when stdout is not a terminal, so pipes stay clean. */
  readonly colour: boolean;
}

function paint(
  text: string,
  colour: keyof typeof COLOURS,
  style: Style
): string {
  return style.colour ? `${COLOURS[colour]}${text}${RESET}` : text;
}

const RECORD_TYPES: Readonly<Record<number, string>> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  15: "MX",
  16: "TXT",
  28: "AAAA",
  257: "CAA",
};

export function recordTypeName(type: number): string {
  return RECORD_TYPES[type] ?? String(type);
}

function summaryOf(finding: Finding): string {
  return DIAGNOSIS_REGISTRY[finding.code as DiagnosisCode].summary;
}

function findingLines(finding: Finding, style: Style): string[] {
  const mark = finding.severity === "error" ? "x" : "!";
  const colour = finding.severity === "error" ? "red" : "yellow";
  const lines = [
    `    ${
      finding.severity === "info"
        ? paint("-", "dim", style)
        : paint(mark, colour, style)
    } ${summaryOf(finding)}`,
  ];

  const { evidence } = finding;

  if (evidence.detail !== undefined) {
    lines.push(`      ${paint(evidence.detail, "dim", style)}`);
  }

  if (evidence.observed !== undefined) {
    lines.push(`      ${paint("found:", "dim", style)}  ${evidence.observed}`);
  }

  if (evidence.expected !== undefined) {
    lines.push(`      ${paint("wanted:", "dim", style)} ${evidence.expected}`);
  }

  lines.push(`      ${paint(finding.code, "dim", style)}`);

  return lines;
}

/**
 * The human-readable report.
 *
 * Ordered worst first, like the web checker, so the thing to fix is the first
 * thing read. Nothing is hidden behind a flag except the query trail, which is
 * long and only wanted when the answer is being argued with.
 */
export function render(
  result: CheckResult,
  options: { style: Style; trace: boolean }
): string[] {
  const { style, trace } = options;
  const lines: string[] = ["", `${result.domain}`, ""];

  const ordered = [...result.checks].sort(
    (a, b) => rankOf(b.verdict) - rankOf(a.verdict)
  );

  for (const check of ordered) {
    const colour = VERDICT_COLOUR[check.verdict];

    lines.push(
      `  ${paint(VERDICT_MARK[check.verdict], colour, style)} ${check.kind}`
    );

    for (const finding of check.findings) {
      lines.push(...findingLines(finding, style));
    }

    if (trace) {
      for (const lookup of check.lookups) {
        lines.push(
          `      ${paint(
            `${recordTypeName(lookup.type).padEnd(5)} ${lookup.name} → ${
              lookup.outcome.status
            }`,
            "dim",
            style
          )}`
        );
        lines.push(`        ${paint(lookup.purpose, "dim", style)}`);
      }
    }

    lines.push("");
  }

  lines.push(paint(closing(result), VERDICT_COLOUR[result.verdict], style), "");

  return lines;
}

function closing(result: CheckResult): string {
  const errors = result.findings.filter((f) => f.severity === "error").length;

  if (errors > 0) {
    return `${errors} problem${errors === 1 ? "" : "s"} to fix`;
  }

  if (result.verdict === "indeterminate") {
    return "some checks could not be completed";
  }

  const warnings = result.findings.filter(
    (f) => f.severity === "warning"
  ).length;

  return warnings > 0
    ? `${warnings} thing${warnings === 1 ? "" : "s"} worth looking at`
    : "nothing to fix";
}

const VERDICT_RANK: Readonly<Record<Verdict, number>> = {
  fail: 3,
  indeterminate: 2,
  pass: 0,
  warn: 1,
};

function rankOf(verdict: Verdict): number {
  return VERDICT_RANK[verdict];
}

export const EXIT_OK = 0;
export const EXIT_PROBLEM = 1;
/**
 * "Could not tell" gets its own exit code.
 *
 * The resolver keeps `indeterminate` separate from `fail` all the way down, and
 * collapsing them here would undo that at the one place a script reads. A CI
 * job that fails a deploy on a resolver blip is precisely the outcome the
 * four-valued verdict exists to prevent.
 */
export const EXIT_UNKNOWN = 2;

export function exitCodeFor(result: CheckResult): number {
  if (result.findings.some((finding) => finding.severity === "error")) {
    return EXIT_PROBLEM;
  }

  return result.verdict === "indeterminate" ? EXIT_UNKNOWN : EXIT_OK;
}
