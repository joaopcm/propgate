import type { RequirementResult } from "../profiles/compile";

export function observationFor(result: RequirementResult): string {
  if (result.findings.length === 0) {
    return result.verdict;
  }

  const codes = [...result.findings.map((finding) => finding.code)].sort();

  return `${result.verdict}:${codes.join(",")}`;
}
