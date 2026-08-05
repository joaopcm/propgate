import { readFileSync } from "node:fs";

/**
 * The version, read from `package.json` rather than kept as a second copy.
 *
 * There was a hardcoded constant here, and it drifted the moment somebody
 * published `0.1.1` without editing it — `propgate --version` printed `0.1.0` for
 * two releases. That is a number with no receipt, and the cost lands in the middle
 * of a bug report: a user says which version they are on, it is not the version
 * they are on, and twenty minutes go somewhere unpleasant.
 *
 * `../package.json` resolves correctly in all three layouts, which is what makes
 * one source of truth possible here at all:
 *
 *   src/index.ts   → packages/cli/package.json   (vitest, tsx)
 *   dist/index.js  → packages/cli/package.json   (a local build)
 *   dist/index.js  → <tarball>/package.json      (published — `files` ships dist,
 *                                                 and npm always includes the
 *                                                 manifest at the root)
 *
 * Read lazily rather than at import: `--version` is a rare path, and nothing else
 * in the CLI should pay a synchronous file read to start up.
 */
export function version(): string {
  const path = new URL("../package.json", import.meta.url);
  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    // A CLI that cannot find its own manifest is a broken install, and saying so
    // beats printing a fallback that would be another number with no receipt.
    throw new Error(`could not read ${path.pathname}`, { cause });
  }

  const parsed = JSON.parse(raw) as { version?: unknown };

  if (typeof parsed.version !== "string") {
    throw new Error(`${path.pathname} has no version field`);
  }

  return parsed.version;
}
