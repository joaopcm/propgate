import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configPath,
  credentials,
  DEFAULT_API_URL,
  readConfig,
  writeConfig,
} from "./config";

const NOT_VALID_JSON = /not valid JSON/;

function permissions(path: string): string {
  return statSync(path).mode.toString(8).slice(-3);
}

const made: string[] = [];

function scratch(): NodeJS.ProcessEnv {
  const dir = mkdtempSync(join(tmpdir(), "propgate-cli-"));

  made.push(dir);

  return { XDG_CONFIG_HOME: dir };
}

afterEach(() => {
  made.length = 0;
});

describe("configPath", () => {
  it("honours XDG_CONFIG_HOME", () => {
    expect(configPath({ XDG_CONFIG_HOME: "/tmp/x" })).toBe(
      "/tmp/x/propgate/config.json"
    );
  });

  it("ignores a relative XDG_CONFIG_HOME", () => {
    const path = configPath({ XDG_CONFIG_HOME: "relative" });

    expect(path).toBe(join(homedir(), ".config", "propgate", "config.json"));
    expect(path).not.toContain("relative");
  });
});

describe("writeConfig", () => {
  it("creates the file readable only by its owner", () => {
    const env = scratch();
    const path = writeConfig({ apiKey: "pg_live_secret" }, env);

    expect(permissions(path)).toBe("600");
  });

  it("tightens an existing file that was too permissive", () => {
    const env = scratch();
    const path = configPath(env);

    writeConfig({ apiKey: "first" }, env);
    writeFileSync(path, "{}", { mode: 0o644 });

    writeConfig({ apiKey: "second" }, env);

    expect(permissions(path)).toBe("600");
  });

  it("round-trips through readConfig", () => {
    const env = scratch();

    writeConfig({ apiKey: "k", apiUrl: "http://localhost:3001" }, env);

    expect(readConfig(env)).toEqual({
      apiKey: "k",
      apiUrl: "http://localhost:3001",
    });
  });

  it("leaves no temporary file holding the key", () => {
    const env = scratch();
    const path = writeConfig({ apiKey: "k" }, env);
    const contents = readFileSync(path, "utf8");

    expect(contents).toContain("k");
    expect(() => statSync(`${path}.${process.pid}`)).toThrow();
  });
});

describe("readConfig", () => {
  it("treats a missing file as an empty config", () => {
    expect(readConfig(scratch())).toEqual({});
  });

  it("refuses to guess at a malformed file", () => {
    const env = scratch();

    writeConfig({ apiKey: "k" }, env);
    writeFileSync(configPath(env), "{ not json", { mode: 0o600 });

    expect(() => readConfig(env)).toThrow(NOT_VALID_JSON);
  });
});

describe("credentials", () => {
  it("prefers PROPGATE_API_KEY over the stored key", () => {
    const resolved = credentials({
      env: { PROPGATE_API_KEY: "from-env" },
      stored: { apiKey: "from-file" },
    });

    expect(resolved.apiKey).toBe("from-env");
  });

  it("falls back to the stored key", () => {
    expect(
      credentials({ env: {}, stored: { apiKey: "from-file" } }).apiKey
    ).toBe("from-file");
  });

  it("has no key when neither is set", () => {
    expect(credentials({ env: {}, stored: {} }).apiKey).toBeUndefined();
  });

  it("ignores an empty environment variable", () => {
    expect(
      credentials({
        env: { PROPGATE_API_KEY: "" },
        stored: { apiKey: "from-file" },
      }).apiKey
    ).toBe("from-file");
  });

  it("puts --api-url ahead of everything", () => {
    const resolved = credentials({
      apiUrl: "http://flag",
      env: { PROPGATE_API_URL: "http://env" },
      stored: { apiUrl: "http://file" },
    });

    expect(resolved.apiUrl).toBe("http://flag");
  });

  it("then the environment, then the file, then the default", () => {
    expect(
      credentials({ env: { PROPGATE_API_URL: "http://env" }, stored: {} })
        .apiUrl
    ).toBe("http://env");
    expect(
      credentials({ env: {}, stored: { apiUrl: "http://file" } }).apiUrl
    ).toBe("http://file");
    expect(credentials({ env: {}, stored: {} }).apiUrl).toBe(DEFAULT_API_URL);
  });
});
