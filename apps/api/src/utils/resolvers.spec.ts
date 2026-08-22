import { describe, expect, it } from "vitest";
import { parseResolvers } from "./resolvers";

const NO_ADDRESS = /has no address/;
const BAD_PORT = /is not a port between/;
const NO_RESOLVERS = /lists no resolvers/;
const NAMES_THE_ENTRY = /1\.1\.1\.1:http/;

describe("parseResolvers", () => {
  it("defaults the port to 53 rather than guessing a high one", () => {
    expect(parseResolvers("1.1.1.1")).toEqual([
      { address: "1.1.1.1", port: 53 },
    ]);
  });

  it("keeps an explicit port", () => {
    expect(parseResolvers("127.0.0.6:5353")).toEqual([
      { address: "127.0.0.6", port: 5353 },
    ]);
  });

  it("reads a whole pool, ignoring whitespace", () => {
    expect(parseResolvers(" unbound:53, 1.1.1.1 ,9.9.9.9 ")).toEqual([
      { address: "unbound", port: 53 },
      { address: "1.1.1.1", port: 53 },
      { address: "9.9.9.9", port: 53 },
    ]);
  });

  it("handles a bracketed IPv6 literal with a port", () => {
    expect(parseResolvers("[2606:4700:4700::1111]:53")).toEqual([
      { address: "2606:4700:4700::1111", port: 53 },
    ]);
  });

  it("handles a bare IPv6 literal", () => {
    expect(parseResolvers("[2606:4700:4700::1111]")).toEqual([
      { address: "2606:4700:4700::1111", port: 53 },
    ]);
  });

  it("names the entry when the port is not a number", () => {
    expect(() => parseResolvers("1.1.1.1:http")).toThrow(BAD_PORT);
    expect(() => parseResolvers("1.1.1.1:http")).toThrow(NAMES_THE_ENTRY);
  });

  it("rejects a port outside the range", () => {
    expect(() => parseResolvers("1.1.1.1:70000")).toThrow(BAD_PORT);
    expect(() => parseResolvers("1.1.1.1:0")).toThrow(BAD_PORT);
  });

  it("rejects an entry with a port and no address", () => {
    expect(() => parseResolvers(":53")).toThrow(NO_ADDRESS);
  });

  it("refuses a value that is set but empty", () => {
    expect(() => parseResolvers(" , ")).toThrow(NO_RESOLVERS);
  });
});
