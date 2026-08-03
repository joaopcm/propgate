import type { ServerAddress } from "@propgate/dns";
import { parseResolvers } from "./resolvers";

/**
 * The pool, or the single resolver as a pool of one.
 *
 * Falling back rather than requiring `RESOLVER_ADDRESSES` is deliberate: a
 * deployment that has not configured a pool keeps behaving exactly as it did
 * before this landed. Consensus over one vantage point is unanimous by
 * definition, so the code path is the same and the answer is unchanged — which
 * makes this an upgrade nobody has to coordinate.
 */
export function vantagePoints(
  env: { readonly RESOLVER_ADDRESSES?: string },
  fallback: ServerAddress
): readonly ServerAddress[] {
  const configured = env.RESOLVER_ADDRESSES;

  return configured === undefined || configured === ""
    ? [fallback]
    : parseResolvers(configured);
}
