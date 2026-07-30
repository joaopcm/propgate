#!/usr/bin/env node
/**
 * Content hash of zones/, published by the fixture containers as
 * `_rev.canary.test. TXT` and compared against the committed REVISION file in
 * packages/dns globalSetup.
 *
 *   node revision.mjs           # print the hash
 *   node revision.mjs --write   # print and update REVISION
 *
 * This exists to kill the single worst DX failure of a harness like this: editing
 * a zone file, forgetting to reload, and spending an afternoon debugging a test
 * that is asserting against stale data. The canary turns that into a one-line
 * error telling you to run `pnpm dns:up --build`.
 *
 * The canary zone is generated at container start rather than committed, so its
 * own hash cannot feed back into the value it publishes.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const zonesDir = join(packageRoot, "zones");

function walk(dir) {
  const found = [];

  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);

    if (statSync(full).isDirectory()) {
      found.push(...walk(full));
      continue;
    }

    // Keys are inputs to signing, not fixture content: including them would
    // change the revision on every re-key without changing any served answer.
    if (full.includes(`${sep}keys${sep}`)) {
      continue;
    }

    found.push(full);
  }

  return found;
}

const hash = createHash("sha256");

for (const file of walk(zonesDir)) {
  // Hash the path too, so moving a zone between roles changes the revision.
  hash.update(relative(zonesDir, file).split(sep).join("/"));
  hash.update("\0");
  hash.update(readFileSync(file));
  hash.update("\0");
}

const revision = hash.digest("hex").slice(0, 16);

if (process.argv.includes("--write")) {
  writeFileSync(join(packageRoot, "REVISION"), `${revision}\n`);
}

process.stdout.write(`${revision}\n`);
