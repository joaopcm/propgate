import { describe, expect, it } from "vitest";
import type { Command } from "./command";
import { checkCommand } from "./commands/check";
import { domainsCommands } from "./commands/domains";
import { isInteractive, resolve, type Surroundings } from "./resolve";

const domainsAdd = domainsCommands.find(
  (command) => command.path[1] === "add"
) as Command;
const domainsList = domainsCommands.find(
  (command) => command.path[1] === "list"
) as Command;

const scripted = { interactive: false };

function where(overrides: Partial<Surroundings> = {}): Surroundings {
  return { env: {}, stdinTty: true, stdoutTty: true, ...overrides };
}

describe("isInteractive", () => {
  it("needs both ends to be a terminal", () => {
    expect(isInteractive({ json: false, where: where() })).toBe(true);
    expect(
      isInteractive({ json: false, where: where({ stdinTty: false }) })
    ).toBe(false);
    expect(
      isInteractive({ json: false, where: where({ stdoutTty: false }) })
    ).toBe(false);
  });

  it("treats --json as nobody being there", () => {
    expect(isInteractive({ json: true, where: where() })).toBe(false);
  });

  it("stands down in CI even on a pty", () => {
    expect(
      isInteractive({ json: false, where: where({ env: { CI: "true" } }) })
    ).toBe(false);
  });

  it("honours PROPGATE_NO_INPUT for the case nothing else catches", () => {
    expect(
      isInteractive({
        json: false,
        where: where({ env: { PROPGATE_NO_INPUT: "1" } }),
      })
    ).toBe(false);
  });
});

describe("resolve", () => {
  it("names the missing flag rather than waiting for it", async () => {
    const resolution = await resolve(
      domainsAdd,
      { positionals: ["example.com"], values: {} },
      scripted
    );

    expect(resolution.kind).toBe("missing");

    if (resolution.kind === "missing") {
      expect(resolution.message).toContain("domains add needs --profile");
      expect(resolution.message).toContain("guided flow");
    }
  });

  it("names every missing argument at once", async () => {
    const resolution = await resolve(
      domainsAdd,
      { positionals: [], values: {} },
      scripted
    );

    if (resolution.kind !== "missing") {
      throw new Error("expected missing");
    }

    expect(resolution.message).toContain("<domain>");
    expect(resolution.message).toContain("--profile");
  });

  it("does not count an optional field as missing", async () => {
    const resolution = await resolve(
      domainsAdd,
      { positionals: ["example.com"], values: { profile: "sending" } },
      scripted
    );

    expect(resolution.kind).toBe("ok");
  });

  it("passes required values through", async () => {
    const resolution = await resolve(
      domainsAdd,
      {
        positionals: ["example.com"],
        values: { "external-id": "cust_1", profile: "sending" },
      },
      scripted
    );

    if (resolution.kind !== "ok") {
      throw new Error("expected ok");
    }

    expect(resolution.input.positional).toBe("example.com");
    expect(resolution.input.need("profile")).toBe("sending");
    expect(resolution.input.text("external-id")).toBe("cust_1");
  });

  it("rejects a value outside a select's choices", async () => {
    const resolution = await resolve(
      domainsList,
      { positionals: [], values: { state: "sideways" } },
      scripted
    );

    if (resolution.kind !== "invalid") {
      throw new Error("expected invalid");
    }

    expect(resolution.message).toContain("--state must be one of");
    expect(resolution.message).toContain("sideways");
  });

  it("rejects more than one positional", async () => {
    const resolution = await resolve(
      checkCommand,
      { positionals: ["a.example.com", "b.example.com"], values: {} },
      scripted
    );

    expect(resolution.kind).toBe("invalid");
  });

  it("collects a multiselect from repeats and from commas alike", async () => {
    const resolution = await resolve(
      checkCommand,
      { positionals: ["example.com"], values: { only: ["spf,dkim", "mx"] } },
      scripted
    );

    if (resolution.kind !== "ok") {
      throw new Error("expected ok");
    }

    expect(resolution.input.list("only")).toEqual(["spf", "dkim", "mx"]);
  });

  it("rejects an unknown check", async () => {
    const resolution = await resolve(
      checkCommand,
      { positionals: ["example.com"], values: { only: "spf,whois" } },
      scripted
    );

    if (resolution.kind !== "invalid") {
      throw new Error("expected invalid");
    }

    expect(resolution.message).toContain("whois");
  });

  it("treats a given-but-empty list as a mistake, not as silence", async () => {
    const resolution = await resolve(
      checkCommand,
      { positionals: ["example.com"], values: { only: "" } },
      scripted
    );

    expect(resolution.kind).toBe("invalid");
  });

  it("leaves the mail intent unstated unless the flag is given", async () => {
    const silent = await resolve(
      checkCommand,
      { positionals: ["example.com"], values: {} },
      scripted
    );
    const stated = await resolve(
      checkCommand,
      { positionals: ["example.com"], values: { "receives-mail": true } },
      scripted
    );

    if (silent.kind !== "ok" || stated.kind !== "ok") {
      throw new Error("expected ok");
    }

    expect(silent.input.bool("receives-mail")).toBe(false);
    expect(stated.input.bool("receives-mail")).toBe(true);
  });

  it("refuses a positional that is not a domain", async () => {
    const resolution = await resolve(
      checkCommand,
      { positionals: ["localhost"], values: {} },
      scripted
    );

    expect(resolution.kind).toBe("invalid");
  });
});
