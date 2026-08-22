import type { ServerAddress } from "@propgate/dns";

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
      throw new Error(`RESOLVER_ADDRESSES entry "${entry}" has no address`);
    }

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
