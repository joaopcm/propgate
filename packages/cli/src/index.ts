/**
 * @propgate/cli
 *
 * Phase 1 turns this into `propgate check <domain>`, running the same engine as
 * the public checker and the API. Three surfaces, one implementation — the CLI is
 * also the debugging tool we reach for when a customer reports something odd.
 */
import { DIAGNOSIS_REGISTRY } from "@propgate/dns";

export function version(): string {
  return "0.0.0";
}

export function listDiagnosisCodes(): string[] {
  return Object.keys(DIAGNOSIS_REGISTRY).sort();
}

function main(): void {
  process.stdout.write(
    [
      "propgate — DNS diagnosis from the terminal",
      "",
      `${listDiagnosisCodes().length} diagnosis codes registered.`,
      "`propgate check <domain>` arrives in Phase 1.",
      "",
    ].join("\n")
  );
}

// tsup adds the shebang; this guard keeps the module importable from tests.
if (process.argv[1]?.endsWith("index.js")) {
  main();
}
