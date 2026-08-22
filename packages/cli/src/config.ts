import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredConfig {
  readonly apiKey?: string;
  readonly apiUrl?: string;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim();

  return base?.startsWith("/") === true
    ? join(base, "propgate")
    : join(homedir(), ".config", "propgate");
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "config.json");
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): StoredConfig {
  const path = configPath(env);
  let raw: string;

  try {
    raw = readFileSync(path, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }

    throw new Error(`could not read ${path}: ${(cause as Error).message}`, {
      cause,
    });
  }

  try {
    return JSON.parse(raw) as StoredConfig;
  } catch (cause) {
    throw new Error(
      `${path} is not valid JSON. Delete it and run \`propgate signup\` again.`,
      { cause }
    );
  }
}

export function writeConfig(
  config: StoredConfig,
  env: NodeJS.ProcessEnv = process.env
): string {
  const dir = configDir(env);

  mkdirSync(dir, { mode: 0o700, recursive: true });

  const path = configPath(env);
  const temporary = join(dir, `config.json.${process.pid}`);

  try {
    writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, {
      mode: 0o600,
    });
    renameSync(temporary, path);
  } catch (cause) {
    try {
      unlinkSync(temporary);
    } catch {
    }

    throw cause;
  }

  return path;
}

export const DEFAULT_API_URL = "https://api.propgate.dev";

export interface Credentials {
  readonly apiKey: string | undefined;
  readonly apiUrl: string;
}

export function credentials(options: {
  readonly apiUrl?: string | undefined;
  readonly env?: NodeJS.ProcessEnv;
  readonly stored?: StoredConfig;
}): Credentials {
  const env = options.env ?? process.env;
  const stored = options.stored ?? readConfig(env);
  const fromEnv = env.PROPGATE_API_KEY?.trim();

  return {
    apiKey:
      fromEnv !== undefined && fromEnv !== ""
        ? fromEnv
        : stored.apiKey?.trim() || undefined,
    apiUrl:
      options.apiUrl?.trim() ||
      env.PROPGATE_API_URL?.trim() ||
      stored.apiUrl?.trim() ||
      DEFAULT_API_URL,
  };
}
