import { CHECK_KINDS, DIAGNOSIS_REGISTRY } from "@propgate/dns";

/**
 * Numbers the prose quotes, read from the code that owns them.
 *
 * Every one of these was written out as a word or a numeral and every one of
 * them went stale the moment a check kind shipped: "six evaluators" survived two
 * more being added, and "73 diagnosis codes" survived five. Nothing caught it,
 * because a sentence is not type-checked and no spec reads prose.
 *
 * The repo's rule is that a number without a receipt is a landmine. These are
 * the receipts — a page can no longer claim a count the package does not have,
 * because it cannot spell one.
 *
 * Prose that does not need the number should simply drop it rather than import
 * from here. "The resolver, the evaluators, and the taxonomy" says everything
 * "the six evaluators" said, and cannot be wrong.
 */

export const CHECK_COUNT = CHECK_KINDS.length;

export const DIAGNOSIS_COUNT = Object.keys(DIAGNOSIS_REGISTRY).length;

/** The check kinds as prose, e.g. "delegation, spf, dkim, …, ownership, cname". */
export const CHECK_LIST = CHECK_KINDS.join(", ");
