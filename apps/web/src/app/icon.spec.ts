import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APPS_DIR = join(process.cwd(), "../");
const WEB_ICON_PATH = join(process.cwd(), "src/app/icon.svg");

const BACKGROUND_TOKEN = "#0b0b0d";
const SUCCESS_TOKEN = "#22c55e";

function iconPathFor(app: string): string {
  return join(APPS_DIR, app, "src/app/icon.svg");
}

function hasRootLayout(app: string): boolean {
  return existsSync(join(APPS_DIR, app, "src/app/layout.tsx"));
}

function nextApps(): readonly string[] {
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter(hasRootLayout)
    .sort();
}

describe("the favicon", () => {
  const webIcon = readFileSync(WEB_ICON_PATH, "utf8");

  it("finds more than one Next app to compare", () => {
    expect(nextApps().length).toBeGreaterThan(1);
  });

  it("is present in every Next app", () => {
    for (const app of nextApps()) {
      expect(
        existsSync(iconPathFor(app)),
        `apps/${app} has no icon.svg — copy apps/web/src/app/icon.svg to apps/${app}/src/app/icon.svg`
      ).toBe(true);
    }
  });

  it("is byte-identical in every Next app", () => {
    for (const app of nextApps().filter((name) =>
      existsSync(iconPathFor(name))
    )) {
      expect(
        readFileSync(iconPathFor(app), "utf8"),
        `apps/${app}/src/app/icon.svg differs from apps/web/src/app/icon.svg`
      ).toBe(webIcon);
    }
  });

  it("draws the tile in --background and the dot in --success", () => {
    expect(webIcon).toContain(BACKGROUND_TOKEN);
    expect(webIcon).toContain(SUCCESS_TOKEN);
  });

  it("carries an accessible title", () => {
    expect(webIcon).toContain("<title>propgate</title>");
  });
});
