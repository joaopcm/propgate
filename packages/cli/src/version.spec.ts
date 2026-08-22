import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { version } from "./version";

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
    expect(version()).toMatch(SEMVER);
  });
});

describe.skipIf(!existsSync(BUNDLE))("the built binary", () => {
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

    expect(printed).toBe(manifest.version);
  });
});
