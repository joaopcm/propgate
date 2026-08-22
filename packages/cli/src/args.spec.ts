import { describe, expect, it } from "vitest";
import {
  optionsFor,
  parseResolver,
  readArgs,
  signature,
  usageFor,
} from "./args";
import { checkCommand } from "./commands/check";
import { domainsCommands } from "./commands/domains";
import { confirmCommand } from "./commands/signup";
import { webhooksCommands } from "./commands/webhooks";

const domainsAdd = domainsCommands.find((command) => command.path[1] === "add");
const webhooksRotate = webhooksCommands.find(
  (command) => command.path[1] === "rotate"
);

describe("optionsFor", () => {
  it("keeps every pair of commands disjoint", () => {
    const check = readArgs(
      ["check", "example.com", "--code", "123456"],
      optionsFor(checkCommand)
    );

    expect(check.ok).toBe(false);

    const confirm = readArgs(
      ["confirm", "--email", "a@b.co", "--resolver", "1.1.1.1"],
      optionsFor(confirmCommand)
    );

    expect(confirm.ok).toBe(false);
  });

  it("offers --api-url only where there is an API to point at", () => {
    expect(optionsFor(checkCommand)["api-url"]).toBeDefined();
    expect(optionsFor(checkCommand).json).toBeDefined();
    expect(optionsFor(checkCommand).help).toBeDefined();
  });

  it("makes repeatable and multiselect fields collect", () => {
    expect(optionsFor(checkCommand).selector).toEqual({
      multiple: true,
      type: "string",
    });
    expect(optionsFor(checkCommand).only).toEqual({
      multiple: true,
      type: "string",
    });
    expect(optionsFor(checkCommand).trace).toEqual({ type: "boolean" });
  });

  it("rejects an unknown flag rather than ignoring it", () => {
    const read = readArgs(
      ["check", "example.com", "--stritc"],
      optionsFor(checkCommand)
    );

    expect(read.ok).toBe(false);
  });

  it("collects repeated selectors", () => {
    const read = readArgs(
      ["check", "example.com", "--selector", "a", "--selector", "b"],
      optionsFor(checkCommand)
    );

    expect(read.ok).toBe(true);

    if (read.ok) {
      expect(read.values.selector).toEqual(["a", "b"]);
    }
  });
});

describe("usage", () => {
  it("names the required flags in the signature", () => {
    expect(signature(domainsAdd as never)).toBe(
      "propgate domains add <domain> --profile <key> [options]"
    );
  });

  it("describes every field it accepts", () => {
    const text = usageFor(webhooksRotate as never);

    expect(text).toContain("--window-hours <hours>");
    expect(text).toContain("--json");
    expect(text).toContain("<id>");
  });
});

describe("parseResolver", () => {
  it("defaults the port without assuming it was written", () => {
    expect(parseResolver("1.1.1.1")).toEqual({ address: "1.1.1.1", port: 53 });
  });

  it("reads an explicit port", () => {
    expect(parseResolver("127.0.0.1:5353")).toEqual({
      address: "127.0.0.1",
      port: 5353,
    });
  });

  it("does not mistake an IPv6 address for a port", () => {
    expect(parseResolver("2001:db8::1")).toEqual({
      address: "2001:db8::1",
      port: 53,
    });
  });

  it("reads a bracketed IPv6 address with a port", () => {
    expect(parseResolver("[2001:db8::1]:5353")).toEqual({
      address: "2001:db8::1",
      port: 5353,
    });
  });

  it("rejects something that is not a port", () => {
    expect(parseResolver("1.1.1.1:0")).toContain("not a port");
    expect(parseResolver("1.1.1.1:99999")).toContain("not a port");
  });
});
