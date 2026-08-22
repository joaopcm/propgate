import {
  DIAGNOSIS_REGISTRY,
  type DiagnosisCode,
  type Finding,
  type Verdict,
} from "@propgate/dns";
import { EXIT_OK, EXIT_PROBLEM, EXIT_UNKNOWN } from "./exit";

export interface Renderable {
  readonly checks: readonly {
    readonly findings: readonly Finding[];
    readonly kind: string;
    readonly lookups: readonly {
      readonly name: string;
      readonly outcome: { readonly status: string };
      readonly purpose: string;
      readonly type: number;
    }[];
    readonly verdict: Verdict;
  }[];
  readonly domain: string;
  readonly findings: readonly Finding[];
  readonly verdict: Verdict;
}

const RESET = "\u001B[0m";

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

const VERDICT_MARK: Readonly<Record<Verdict, string>> = {
  fail: " x",
  indeterminate: " ?",
  pass: "ok",
  warn: " !",
};

export interface Style {
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
  return (
    DIAGNOSIS_REGISTRY[finding.code as DiagnosisCode]?.summary ?? finding.code
  );
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

export function render(
  result: Renderable,
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

function closing(result: Renderable): string {
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

export function exitCodeFor(result: Renderable): number {
  if (result.findings.some((finding) => finding.severity === "error")) {
    return EXIT_PROBLEM;
  }

  return result.verdict === "indeterminate" ? EXIT_UNKNOWN : EXIT_OK;
}
