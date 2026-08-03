import type { ServerAddress } from "@propgate/dns";

/**
 * The vantage-point pool, from one environment variable.
 *
 * `address:port` entries, comma-separated. The port is explicit and never
 * assumed — invariant 5 exists because the fixture tier serves real port 53 on
 * distinct loopbacks, and because a deployment may run its own Unbound
 * somewhere unusual. It is optional here only so an operator can write
 * `1.1.1.1,9.9.9.9` and mean the obvious thing.
 *
 * Parsed rather than validated by Zod because the failure has to be legible: an
 * operator who fat-fingers this gets the entry they typed and the reason, not a
 * regex.
 */

const DEFAULT_PORT = 53;
const MAX_PORT = 65_535;

export function parseResolvers(raw: string): readonly ServerAddress[] {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");

  if (entries.length === 0) {
    throw new Error(
      "RESOLVER_ADDRESSES is set but lists no resolvers. Use `address:port` entries separated by commas, or leave it unset to fall back to RESOLVER_ADDRESS."
    );
  }

  return entries.map((entry) => {
    if (entry.startsWith(":")) {
      // `:53` — lastIndexOf below would report no port and hand back an address
      // of ":53", which then fails much later as a DNS lookup for a name that
      // cannot exist.
      throw new Error(`RESOLVER_ADDRESSES entry "${entry}" has no address`);
    }

    // Split from the right, so an IPv6 literal in brackets survives.
    const separator = entry.lastIndexOf(":");
    const bracketed = entry.startsWith("[");
    const hasPort = separator > 0 && (!bracketed || entry.includes("]:"));
    const address = hasPort ? entry.slice(0, separator) : entry;
    const portText = hasPort ? entry.slice(separator + 1) : "";
    const port = portText === "" ? DEFAULT_PORT : Number(portText);

    if (address === "") {
      throw new Error(`RESOLVER_ADDRESSES entry "${entry}" has no address`);
    }

    if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) {
      throw new Error(
        `RESOLVER_ADDRESSES entry "${entry}" has port "${portText}", which is not a port between 1 and ${MAX_PORT}`
      );
    }

    return { address: address.replace(/^\[|\]$/g, ""), port };
  });
}
