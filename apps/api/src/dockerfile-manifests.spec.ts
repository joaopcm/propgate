import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);

function workspaceDirectories(): readonly string[] {
  const yaml = readFileSync(new URL("pnpm-workspace.yaml", root), "utf8");

  return [...yaml.matchAll(/^\s*-\s*"?([^"\s]+)\/\*"?\s*$/gm)].flatMap(
    (match) => match[1] ?? []
  );
}

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

    expect(missing).toEqual([]);
  });

  it("copies nothing that is no longer a workspace package", () => {
    const present = new Set(manifests());

    expect(copied().filter((path) => !present.has(path))).toEqual([]);
  });
});
