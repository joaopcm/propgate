import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One favicon, three apps, no shared package.
 *
 * `apps/web` is the source: it owns the mark, and the tab a customer sees first
 * is propgate.dev. The other apps carry a copy, because Next resolves
 * `src/app/icon.svg` per app by file convention and there is nowhere to put a
 * single file that all three would find.
 *
 * A `packages/brand` for one SVG is the wrong trade. `.claude/CLAUDE.md` lists
 * `ui` as deliberately unbuilt and says not to add it early; inventing a sibling
 * package to hold thirty lines of markup is that same mistake with a different
 * name. A symlink would work in git and is a coin flip through Turbopack, a
 * Docker build context and Cloudflare's asset upload — three places where "it
 * probably follows symlinks" is not a sentence worth betting a favicon on.
 *
 * So: copies, and a test that makes them impossible to drift. Same shape as
 * `apps/api/src/dockerfile-manifests.spec.ts` — the filesystem is the list, and
 * a new app that forgets the icon fails here with the fix in the message.
 *
 * This lives in `apps/web` because that is the app being copied *from*. If the
 * mark changes, it changes here, and every other app fails until it catches up.
 */

const REPO_ROOT = join(process.cwd(), "../..");
const APPS = join(REPO_ROOT, "apps");
const SOURCE = join(process.cwd(), "src/app/icon.svg");

/**
 * Every Next app, found by its root layout.
 *
 * Read rather than listed so a fourth app is covered the day it appears, and
 * `apps/api` is excluded without naming it — it is a Hono service with no
 * `src/app/layout.tsx` and no favicon to have.
 */
function nextApps(): readonly string[] {
  return readdirSync(APPS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => existsSync(join(APPS, name, "src/app/layout.tsx")))
    .sort();
}

describe("the favicon", () => {
  const icon = readFileSync(SOURCE, "utf8");

  it("finds more than one Next app to compare", () => {
    expect(nextApps().length).toBeGreaterThan(1);
  });

  it("is present in every Next app", () => {
    for (const app of nextApps()) {
      const path = join(APPS, app, "src/app/icon.svg");

      expect(
        existsSync(path),
        `apps/${app} has no icon.svg — copy apps/web/src/app/icon.svg to apps/${app}/src/app/icon.svg`
      ).toBe(true);
    }
  });

  it("is identical in every Next app", () => {
    for (const app of nextApps()) {
      const path = join(APPS, app, "src/app/icon.svg");

      if (!existsSync(path)) {
        continue;
      }

      expect(
        readFileSync(path, "utf8"),
        `apps/${app}/src/app/icon.svg differs from apps/web's`
      ).toBe(icon);
    }
  });

  /**
   * The two things about the mark that are load-bearing rather than aesthetic.
   *
   * The tile is `--background` from every app's stylesheet, and the dot is
   * `--success` — the same green a passing verdict uses. If either drifts from
   * the design tokens the icon stops being the product's mark and becomes a
   * picture that resembles it.
   */
  it("uses the shared background and success tokens", () => {
    expect(icon).toContain("#0b0b0d");
    expect(icon).toContain("#22c55e");
  });

  it("carries an accessible title", () => {
    expect(icon).toContain("<title>propgate</title>");
  });
});
