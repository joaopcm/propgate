import { describe, expect, it } from "vitest";
import { parseResolvers } from "./resolvers";

/**
 * One environment variable an operator types by hand.
 *
 * Every failure here has to name the entry that was wrong. An agent can fix
 * `entry "1.1.1.1:abc" has port "abc"`; nobody can fix a regex that returned
 * false.
 */

const NO_ADDRESS = /has no address/;
const BAD_PORT = /is not a port between/;
const NO_RESOLVERS = /lists no resolvers/;
const NAMES_THE_ENTRY = /1\.1\.1\.1:http/;

describe("parseResolvers", () => {
  it("defaults the port to 53 rather than guessing a high one", () => {
    // Invariant 5 says never assume 53 — but this is a written default rather
    // than an assumption, and an operator writing `1.1.1.1` means the DNS port.
    expect(parseResolvers("1.1.1.1")).toEqual([
      { address: "1.1.1.1", port: 53 },
    ]);
  });

  it("keeps an explicit port", () => {
    // The fixture tier depends on this: it serves real port 53 on distinct
    // loopbacks, and a dev box may point at something else entirely.
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
    // The reason the split is from the right. Splitting on the first colon would
    // turn `[2606:4700:4700::1111]:53` into an address of `[2606`.
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
    // Set-but-empty is a different mistake from unset, and it deserves a
    // different message: unset is a supported way to run, this is a typo.
    expect(() => parseResolvers(" , ")).toThrow(NO_RESOLVERS);
  });
});
