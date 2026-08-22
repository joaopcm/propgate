import type { ServerAddress } from "@propgate/dns";
import { parseResolvers } from "./resolvers";

export function vantagePoints(
  env: { readonly RESOLVER_ADDRESSES?: string },
  fallback: ServerAddress
): readonly ServerAddress[] {
  const configured = env.RESOLVER_ADDRESSES;

  return configured === undefined || configured === ""
    ? [fallback]
    : parseResolvers(configured);
}
