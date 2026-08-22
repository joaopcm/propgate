import { readFileSync } from "node:fs";

export function version(): string {
  const path = new URL("../package.json", import.meta.url);
  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    throw new Error(`could not read ${path.pathname}`, { cause });
  }

  const parsed = JSON.parse(raw) as { version?: unknown };

  if (typeof parsed.version !== "string") {
    throw new Error(`${path.pathname} has no version field`);
  }

  return parsed.version;
}
