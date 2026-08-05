import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { version } from "./version";

/**
 * That `--version` tells the truth.
 *
 * A hardcoded constant here drifted from the manifest for two releases, so the
 * point of this file is that the drift cannot come back quietly. The first two
 * assertions share a mechanism with the implementation and would not catch a bug
 * within `readFileSync` itself; what they do catch is somebody replacing the read
 * with a literal again, which is the regression that actually happened.
 *
 * The third runs the built binary, and that one is not tautological at all — it is
 * the only check that the version survives bundling, where `import.meta.url` moves
 * from `src/` to `dist/`.
 */

const SEMVER = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;

const manifest = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
) as { version: string };

const BUNDLE = new URL("../dist/index.js", import.meta.url);

describe("version", () => {
  it("is the version in package.json", () => {
    expect(version()).toBe(manifest.version);
  });

  it("looks like a version", () => {
    // Guards against returning something truthy but useless — `undefined`
    // stringified, a path, an empty string.
    expect(version()).toMatch(SEMVER);
  });
});

/**
 * Skipped rather than quietly passing when there is no build.
 *
 * `pnpm test` does not depend on `pnpm build`, so on a clean checkout there is
 * nothing to run. Reporting that as a pass would be the worse lie of the two — the
 * suite would claim to have checked an artefact it never looked at.
 */
describe.skipIf(!existsSync(BUNDLE))("the built binary", () => {
  /**
   * Through a symlink, the way npm actually installs it.
   *
   * `npm` links `.bin/propgate` → `dist/index.js`, and this is the only test that
   * exercises that shape. Running `node dist/index.js` directly passes even when
   * the bin is completely broken, which is exactly what happened: every published
   * release exited 0 and printed nothing under `npx`, for three versions, while
   * the suite stayed green.
   */
  it("runs when invoked through a bin symlink", () => {
    const link = join(mkdtempSync(join(tmpdir(), "propgate-bin-")), "propgate");

    symlinkSync(BUNDLE.pathname, link);

    const printed = execFileSync("node", [link, "--version"], {
      encoding: "utf8",
    }).trim();

    expect(printed).toBe(manifest.version);
  });

  it("prints the version from the manifest", () => {
    const printed = execFileSync("node", [BUNDLE.pathname, "--version"], {
      encoding: "utf8",
    }).trim();

    // Two things at once, and both have been broken: that `../package.json`
    // resolves from `dist/` as well as `src/`, and that `--version` reaches the
    // version branch at all rather than falling into help.
    expect(printed).toBe(manifest.version);
  });
});
