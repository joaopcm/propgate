import type { ComponentType } from "react";
import Unit0 from "./00-the-last-twenty-percent/unit.mdx";
import Unit1 from "./01-dns-does-not-tell-the-truth/unit.mdx";
import Unit2 from "./02-a-resolver-with-no-dependencies/unit.mdx";
import Unit3 from "./03-spf-the-way-an-mta-reads-it/unit.mdx";
import Unit4 from "./04-keys-policies-and-trees/unit.mdx";
import Unit5 from "./05-asking-the-right-question/unit.mdx";
import Unit6 from "./06-believing-a-failure/unit.mdx";
import Unit7 from "./07-the-parts-that-cost-money/unit.mdx";
import Unit8 from "./08-publishing-a-contract/unit.mdx";

/**
 * Each unit's prose as a component, keyed by slug.
 *
 * Nine static imports rather than `await import(\`./${dir}/unit.mdx\`)`. A
 * template-literal import asks the bundler to guess at a set of modules from a
 * string it cannot see, which under `output: "export"` is the kind of thing
 * that works in dev and produces an empty page in the build. Same argument as
 * `src/lib/quiz/all.ts`, and `curriculum.spec.ts` checks this file mentions
 * every unit's directory so an omission is a failing test rather than a 404.
 */
export const UNIT_CONTENT: Readonly<Record<string, ComponentType>> = {
  "a-resolver-with-no-dependencies": Unit2,
  "asking-the-right-question": Unit5,
  "believing-a-failure": Unit6,
  "dns-does-not-tell-the-truth": Unit1,
  "keys-policies-and-trees": Unit4,
  "publishing-a-contract": Unit8,
  "spf-the-way-an-mta-reads-it": Unit3,
  "the-last-twenty-percent": Unit0,
  "the-parts-that-cost-money": Unit7,
};
