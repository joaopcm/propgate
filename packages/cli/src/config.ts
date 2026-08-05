import {
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Where the API key lives between commands.
 *
 * A file rather than an environment variable as the primary store, because
 * `confirm` has to put the key somewhere the next command can find it without the
 * user copying it — and an env var cannot be set by a child process. `check` never
 * touches any of this: it resolves locally, needs no account, and must keep
 * working on a machine that has never run `signup`.
 */

export interface StoredConfig {
  readonly apiKey?: string;
  readonly apiUrl?: string;
}

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_CONFIG_HOME?.trim();

  // The spec says an absolute path or ignore it, and honouring a relative one
  // would put a credential somewhere that depends on the working directory.
  return base?.startsWith("/") === true
    ? join(base, "propgate")
    : join(homedir(), ".config", "propgate");
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(configDir(env), "config.json");
}

/**
 * The stored config, or an empty one.
 *
 * A missing file is normal — nobody has signed up yet. Anything else is not
 * swallowed: a config that exists but cannot be read is a real problem, and
 * returning `{}` for it would make the next command say "not authenticated",
 * which sends the reader looking for a key that is sitting right there.
 */
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

/**
 * Write the config so it is never briefly world-readable.
 *
 * Written to a temporary file with mode 0600 and renamed over the target, rather
 * than written in place and chmodded after. The chmod version has a real window
 * on a shared machine — the key is on disk at the umask's mode until the second
 * call lands — and `writeFileSync`'s `mode` is ignored outright when the file
 * already exists, so an existing 0644 config would silently stay 0644. The rename
 * is atomic and carries the temp file's mode with it, which fixes both.
 */
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
    // Do not leave the half-written file behind holding a key.
    try {
      unlinkSync(temporary);
    } catch {
      // Already gone, which is the outcome we wanted.
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

/**
 * The key and the base URL, in precedence order.
 *
 * `PROPGATE_API_KEY` beats the file so CI can run without one, and `--api-url`
 * beats everything so a local stack is one flag away.
 */
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
