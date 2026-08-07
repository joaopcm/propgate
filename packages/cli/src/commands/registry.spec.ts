import { describe, expect, it } from "vitest";
import { commandName } from "../command";
import { COMMANDS, lookup } from "./registry";

/**
 * The parity tripwire.
 *
 * The CLI is supposed to reach every endpoint the API has. Nothing enforced that
 * before, and the answer drifted to seven of twenty-two without a single test
 * going red. The list below is hand-kept — there is no OpenAPI document to derive
 * it from — but it is hand-kept *next to an assertion*, so adding a route and
 * forgetting the command fails here rather than in a support thread.
 *
 * `GET /health` is deliberately absent: a container healthcheck is not a command.
 */

const ENDPOINTS: readonly { command: string; endpoint: string }[] = [
  { command: "check", endpoint: "POST /v1/checks" },
  { command: "signup", endpoint: "POST /v1/signup" },
  { command: "confirm", endpoint: "POST /v1/signup/confirm" },
  { command: "keys create", endpoint: "POST /v1/api-keys" },
  { command: "keys list", endpoint: "GET /v1/api-keys" },
  { command: "keys revoke", endpoint: "DELETE /v1/api-keys/:id" },
  { command: "members list", endpoint: "GET /v1/members" },
  { command: "profiles create", endpoint: "POST /v1/profiles" },
  { command: "profiles get", endpoint: "GET /v1/profiles/:key" },
  { command: "domains add", endpoint: "POST /v1/domains" },
  { command: "domains list", endpoint: "GET /v1/domains" },
  { command: "domains get", endpoint: "GET /v1/domains/:id" },
  { command: "domains check", endpoint: "POST /v1/domains/:id/checks" },
  { command: "domains timeline", endpoint: "GET /v1/domains/:id/timeline" },
  { command: "domains delete", endpoint: "DELETE /v1/domains/:id" },
  { command: "webhooks create", endpoint: "POST /v1/webhooks" },
  { command: "webhooks list", endpoint: "GET /v1/webhooks" },
  { command: "webhooks get", endpoint: "GET /v1/webhooks/:id" },
  { command: "webhooks update", endpoint: "PATCH /v1/webhooks/:id" },
  { command: "webhooks delete", endpoint: "DELETE /v1/webhooks/:id" },
  { command: "webhooks rotate", endpoint: "POST /v1/webhooks/:id/secret" },
  {
    command: "webhooks deliveries",
    endpoint: "GET /v1/webhooks/:id/deliveries",
  },
];

const names = COMMANDS.map(commandName);

describe("coverage", () => {
  it.each(ENDPOINTS)("$endpoint is reachable as `$command`", ({ command }) => {
    expect(names).toContain(command);
  });

  it("has a command for every endpoint and no command without one", () => {
    // Both directions. The first catches a route nobody exposed; the second
    // catches a command left behind by a route that was removed.
    expect([...names].sort()).toEqual(
      [...ENDPOINTS.map((entry) => entry.command)].sort()
    );
  });
});

describe("lookup", () => {
  it("prefers a two-word command over its family", () => {
    const match = lookup(["domains", "list"]);

    expect(match.kind).toBe("command");

    if (match.kind === "command") {
      expect(commandName(match.command)).toBe("domains list");
    }
  });

  it("treats a family alone as a request to see what is under it", () => {
    expect(lookup(["webhooks"])).toEqual({
      family: "webhooks",
      kind: "family",
    });
  });

  it("reports an unknown first word rather than guessing", () => {
    expect(lookup(["inspect"])).toEqual({ kind: "unknown", word: "inspect" });
  });

  it("does not read a domain as a subcommand of check", () => {
    const match = lookup(["check", "example.com"]);

    if (match.kind !== "command") {
      throw new Error("expected a command");
    }

    expect(commandName(match.command)).toBe("check");
  });
});

describe("declarations", () => {
  it("gives every field a prompt, so the guided path is never blank", () => {
    for (const command of COMMANDS) {
      for (const field of command.fields) {
        expect(
          field.prompt,
          `${commandName(command)} --${field.flag}`
        ).not.toBe("");
      }
    }
  });

  it("gives every select and multiselect something to choose from", () => {
    for (const command of COMMANDS) {
      for (const field of command.fields) {
        if (field.kind === "select" || field.kind === "multiselect") {
          expect(
            field.choices?.length ?? 0,
            `${commandName(command)} --${field.flag}`
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  /**
   * The regression these two exist for.
   *
   * A command whose fields are each optional but not collectively — `profiles
   * create` needs a key, `webhooks update` needs something to change — skipped
   * every prompt and then errored, so the guided flow was unreachable for
   * exactly the commands that most needed it.
   */
  it("asks for a field that run() requires even when the flag is optional", () => {
    const cases = [
      ["profiles create", "key"],
      ["webhooks update", "state"],
      ["webhooks update", "events"],
    ] as const;

    for (const [name, flag] of cases) {
      const field = COMMANDS.find(
        (command) => commandName(command) === name
      )?.fields.find((entry) => entry.flag === flag);

      expect(field?.promptWhenOptional, `${name} --${flag}`).toBe(true);
    }
  });

  it("never offers two boolean flags for one two-valued thing", () => {
    // `--disable` and `--enable` needed a guard against being passed together,
    // for a state that a single `select` cannot express in the first place.
    for (const command of COMMANDS) {
      const flags = command.fields.map((field) => field.flag);

      expect(
        flags.includes("disable") && flags.includes("enable"),
        commandName(command)
      ).toBe(false);
    }
  });

  it("authenticates everything except the three that cannot be", () => {
    // `check` runs before an account exists, and the signup pair is how one comes
    // to exist. Everything else carries a bearer token.
    const open = COMMANDS.filter((command) => !command.authenticated).map(
      commandName
    );

    expect(open.sort()).toEqual(["check", "confirm", "signup"]);
  });
});
