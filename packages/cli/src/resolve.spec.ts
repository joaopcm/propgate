import { describe, expect, it } from "vitest";
import type { Command } from "./command";
import { checkCommand } from "./commands/check";
import { domainsCommands } from "./commands/domains";
import { isInteractive, resolve, type Surroundings } from "./resolve";

/**
 * The flag-to-prompt-to-refusal decision, on its own.
 *
 * Pure by construction: `resolve` is handed the interactive decision as a
 * boolean, so nothing here needs a TTY and nothing here can reach clack. The
 * case that matters most is the last one — a missing flag with nobody to ask
 * must be an error, because the alternative is a build agent blocked on stdin
 * until its timeout with no output saying why.
 */

const domainsAdd = domainsCommands.find(
  (command) => command.path[1] === "add"
) as Command;
const domainsList = domainsCommands.find(
  (command) => command.path[1] === "list"
) as Command;

/** Never interactive: every spec below drives the non-prompting path. */
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
    // Asking for machine-readable output says the output is going somewhere that
    // cannot type, and a select list drawn into a pipe is not JSON.
    expect(isInteractive({ json: true, where: where() })).toBe(false);
  });

  it("stands down in CI even on a pty", () => {
    // Some runners allocate one. `CI=true` is the signal that survives that.
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
      // An agent can act on "needs --profile". It cannot act on a hung process.
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

    // Fixing one and rerunning to discover the next is a worse loop than being
    // told both the first time.
    expect(resolution.message).toContain("<domain>");
    expect(resolution.message).toContain("--profile");
  });

  it("does not count an optional field as missing", async () => {
    // `--external-id` is offered in the guided flow and never required of a
    // script that did not pass one.
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
    // One domain at a time. Accepting several would make the exit code a summary
    // of unrelated answers, which is worse than running it twice.
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
    // `--only ""` was an attempt to say something. Running every check instead is
    // not what it said.
    const resolution = await resolve(
      checkCommand,
      { positionals: ["example.com"], values: { only: "" } },
      scripted
    );

    expect(resolution.kind).toBe("invalid");
  });

  it("leaves the mail intent unstated unless the flag is given", async () => {
    // Three states, not two. Defaulting to "this domain receives mail" would
    // report every sending-only domain as broken, and defaulting the other way
    // would miss a mail domain that cannot receive anything.
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
