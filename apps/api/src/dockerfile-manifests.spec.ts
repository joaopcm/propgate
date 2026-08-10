import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every workspace manifest, against the ones `apps/api/Dockerfile` copies.
 *
 * The Dockerfile has to copy *all* of them, not just the ones it builds: pnpm
 * resolves the whole workspace graph even behind `--filter`, so one missing
 * manifest fails the install — or, worse, fails only at `pnpm deploy`, several
 * cached layers later. That is how @propgate/sdk broke the deploy build: it was
 * added as a devDependency of this app, the hand-written list never grew a line,
 * and `pnpm test` was green the whole time.
 *
 * So the filesystem is the list. A new package fails here, in the ungated
 * project, with the line to add already in the message.
 */

const root = new URL("../../../", import.meta.url);

/**
 * The workspace globs, read rather than hardcoded — a third one would otherwise
 * be invisible to this check.
 *
 * Only the trailing-`*` form is understood, which is both globs the workspace
 * has. Anything else is deliberately left out: guessing at a pattern this does
 * not implement would make the check quietly incomplete.
 */
function workspaceDirectories(): readonly string[] {
  const yaml = readFileSync(new URL("pnpm-workspace.yaml", root), "utf8");

  return [...yaml.matchAll(/^\s*-\s*"?([^"\s]+)\/\*"?\s*$/gm)].flatMap(
    (match) => match[1] ?? []
  );
}

/** Every directory under a workspace glob that actually holds a manifest. */
function manifests(): readonly string[] {
  return workspaceDirectories()
    .flatMap((directory) =>
      readdirSync(fileURLToPath(new URL(directory, root)), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `${directory}/${entry.name}`)
    )
    .filter((path) =>
      existsSync(fileURLToPath(new URL(`${path}/package.json`, root)))
    )
    .sort();
}

/** The workspace paths the Dockerfile copies a manifest for. */
function copied(): readonly string[] {
  const dockerfile = readFileSync(new URL("apps/api/Dockerfile", root), "utf8");

  return [
    ...dockerfile.matchAll(/^COPY\s+(\S+)\/package\.json\s+\S+$/gm),
  ].flatMap((match) => match[1] ?? []);
}

describe("apps/api/Dockerfile against the workspace", () => {
  it("copies a manifest for every workspace package", () => {
    const present = new Set(copied());
    const missing = manifests()
      .filter((path) => !present.has(path))
      .map((path) => `COPY ${path}/package.json ${path}/`);

    // The fix, not the count: an agent can apply "COPY packages/sdk/package.json
    // packages/sdk/" and cannot do anything with "expected 10 to be 11".
    expect(missing).toEqual([]);
  });

  it("copies nothing that is no longer a workspace package", () => {
    const present = new Set(manifests());

    // A COPY for a deleted package fails the build outright, so this direction
    // is about catching it here instead of on a push to main.
    expect(copied().filter((path) => !present.has(path))).toEqual([]);
  });
});
