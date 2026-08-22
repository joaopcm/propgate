#!/usr/bin/env node
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

    if (full.includes(`${sep}keys${sep}`)) {
      continue;
    }

    found.push(full);
  }

  return found;
}

const hash = createHash("sha256");

for (const file of walk(zonesDir)) {
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
