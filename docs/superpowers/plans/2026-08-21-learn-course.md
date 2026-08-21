# apps/learn — the propgate course Implementation Plan

**Goal:** A public, self-paced course that teaches how domain verification actually works, using propgate as the worked example. Nine units, each gated by a mastery quiz, ending in a final exam. Progress lives in the reader's browser. Every unit that can be verified by running something against the real DNS fixture tier does so.

**Architecture:** A new `apps/learn` Next 16 static export, deployed to `learn.propgate.dev` as Cloudflare assets, the same shape `apps/docs` and `apps/web` already use. `src/lib/curriculum.ts` is the single source of truth for what units exist and in what order; a spec walks it against the filesystem so a unit cannot be listed without existing. Quiz questions come from two places: some are generated at build time from `DIAGNOSIS_REGISTRY`, `FIXTURE_EXPECTATIONS` and `REQUIREMENTS`, so they cannot drift from the code; the rest are authored TypeScript, because the interesting answers are judgment calls no registry holds.

**Tech Stack:** Next.js 16 (`output: "export"`), `@next/mdx`, `@shikijs/rehype`, Tailwind 4, Vitest 4, wrangler static assets. No new runtime dependencies beyond fonts.

---

## Why this exists, and what it is not

The repository already explains itself well. `hysteresis.ts`, `check/profile.ts`,
`conformance/requirements.ts` and `sweep/schedule.ts` read like essays, and
`apps/docs` publishes the taxonomy and the RFC ledger from the code that
produces them. What none of that does is put the ideas in an order, or check
whether a reader followed.

That is the gap this fills. A reference answers a question somebody already
knows to ask. This is for the reader who does not yet know that NODATA and
NXDOMAIN are different things, or why a wildcard record will mark an
unconfigured domain as verified.

It is **not** a second copy of the docs. Where a unit needs the taxonomy or the
conformance ledger, it links to `docs.propgate.dev` rather than restating it.
The course owns the narrative and the exercises; the docs own the reference.

It is also not a sales page. propgate is the case study because its source is
public and its fixtures are runnable, and the honest parts of that story include
the decisions that were wrong: expected values shipped on the profile and had to
move to the domain, and two requirements resolving to the same selector were
both attributed the first one's outcome, which meant a domain could read
verified for a key nobody had published. Those belong in the course. A course
that only shows the parts that worked teaches nothing about how to build one of
these.

## Global constraints

- **No `@propgate/ui`.** `.claude/CLAUDE.md` lists `ui` as deliberately not
  built. Write the four-line `cn` helper, the way `apps/docs` does.
- **No new runtime dependencies.** `next`, `react`, `@next/mdx`,
  `@shikijs/rehype`, `shiki`, `remark-gfm` and `tailwindcss` only, matching
  `apps/docs/package.json`. Fonts come from `next/font/google`.
- **`output: "export"` stays.** Progress is client-side by design, so there is
  nothing here that wants a server. Introducing one would be a decision, not a
  discovery.
- **No hardcoded counts in prose.** The taxonomy has 78 codes today and had 74
  when the docs were restructured. Every count a unit states comes from
  `src/lib/counts.ts`, which reads the packages. A course that says
  "seventy-eight" in MDX is a course that will be wrong.
- **No mocked DNS, and no simulated resolver in the browser.** Invariant 1
  applies to a thing that teaches invariant 1. Exercises are commands the reader
  runs against `pnpm dns:up`. A unit is readable without Docker; its exercises
  are not, and they say so.
- **No percentage anywhere.** Not on a quiz, not on the spine, not on the exam.
  A passing threshold of 80% is an unmeasured number, and this repository calls
  that a landmine. A unit passes when every question in it has been answered
  correctly, with unlimited retries.
- **Third person, no insider framing.** The reader did not build this.
- Comments explain *why*. `pnpm fix` before each commit. `pnpm lint` and
  `pnpm check` clean, and `pnpm --filter @propgate/learn build` succeeding, at
  the end of every task.
- Biome will reject: bitwise operators, regexes declared inside functions,
  `await` inside loops, array index access where destructuring works.

## The curriculum

Nine units, ordered so each one is a prerequisite for the next, plus an exam
drawing from all of them.

| # | Slug | Title | The thing the reader leaves with |
|---|---|---|---|
| 0 | `the-last-twenty-percent` | The last 20% | Why "record not found" is the bug and not the answer |
| 1 | `dns-does-not-tell-the-truth` | DNS does not tell the truth | NODATA vs NXDOMAIN, negative caching, wildcard synthesis, CNAME flattening, appended zone names, TXT splitting, truncation |
| 2 | `a-resolver-with-no-dependencies` | A resolver with no dependencies | The wire format by hand, name compression, EDNS0, delegation following, why port is a field and not the number 53 |
| 3 | `spf-the-way-an-mta-reads-it` | SPF the way an MTA reads it | The ten-lookup limit and where it is counted, the two-void limit, macros, redirect versus all |
| 4 | `keys-policies-and-trees` | Keys, policies, and trees | DKIM key parsing and revocation, DMARC at the organizational domain, null MX, CAA tree climbing |
| 5 | `asking-the-right-question` | Asking the right question | Profiles as shape, expectations as values, four verdicts, and why a skipped check is not a passing one |
| 6 | `believing-a-failure` | Believing a failure | Consensus across vantage points, hysteresis, and the adaptive schedule |
| 7 | `the-parts-that-cost-money` | The parts that cost money | Store changes not observations, why the sweeper cannot be serverless, Postgres as truth and Redis as the conveyor |
| 8 | `publishing-a-contract` | Publishing a contract | Diagnosis codes as an API, coverage guards, and why no percentage of an RFC exists |

Units 1 through 4 are the DNS half and carry most of the exercises. Units 5
through 8 are the systems half and carry most of the reasoning questions.

## File structure

**The shell:**

| File | Responsibility |
|---|---|
| `apps/learn/package.json` | `@propgate/learn`, private, deps mirroring `apps/docs` |
| `apps/learn/next.config.ts` | `output: "export"`, MDX, Shiki, `transpilePackages` for `@propgate/dns` and `@propgate/dns-fixtures` |
| `apps/learn/wrangler.jsonc` | `learn.propgate.dev`, assets from `./out`, no Worker script |
| `apps/learn/vitest.config.ts` | jsdom, matching `apps/docs` |
| `src/app/layout.tsx` | Fonts, dark shell, metadata |
| `src/app/globals.css` | Tokens: severity shared with docs, type scale its own |
| `src/lib/cn.ts` | Four lines, no dependency |
| `src/lib/shiki.ts` | `SHIKI_THEME`, `highlight()`. Same theme as docs |
| `src/lib/slug.ts` | Heading slugs for in-unit anchors |

**The curriculum model:**

| File | Responsibility |
|---|---|
| `src/lib/curriculum.ts` | `Unit[]` with slug, title, blurb, sections, and whether it has exercises. Ordering is array order |
| `src/lib/curriculum.spec.ts` | Slugs unique, every unit has `unit.mdx` and `quiz.ts` on disk, no gaps in order |
| `src/lib/counts.ts` | `diagnosisCodeCount()`, `applicableRequirementCount()`, `fixtureZoneCount()`, `rfcCount()`, read from the packages |
| `src/lib/counts.spec.ts` | Each count is non-zero and derived, not a literal |

**Progress:**

| File | Responsibility |
|---|---|
| `src/lib/progress.ts` | `localStorage` under `propgate.learn.progress.v1`. Read, write, export, import, reset. Derives locked/open from the curriculum plus the stored record |
| `src/lib/progress.spec.ts` | Round trip, unknown version ignored rather than migrated, a passed unit opening the next, a skipped unit staying distinguishable |

**Quizzes:**

| File | Responsibility |
|---|---|
| `src/lib/quiz/types.ts` | `Question` — prompt, options, one correct index, explanation, `source` naming a repository path |
| `src/lib/quiz/derived.ts` | Questions built from `DIAGNOSIS_REGISTRY`, `FIXTURE_EXPECTATIONS`, `REQUIREMENTS` at build time |
| `src/lib/quiz/derived.spec.ts` | Every derived answer still resolves against the registry it came from |
| `src/lib/quiz/authored.spec.ts` | Every authored question: two or more options, exactly one correct, a non-empty explanation, and a `source` path that exists |
| `src/lib/quiz/exam.ts` | The final exam, sampled deterministically across all nine units |

**Components:**

| File | Responsibility |
|---|---|
| `src/components/spine.tsx` | Client. The nine-unit rail with node states |
| `src/components/unit-header.tsx` | Server. Number, title, blurb, what it assumes |
| `src/components/lookup.tsx` | Server. One exercise: the command, the expected shape, a collapsed "what to notice" |
| `src/components/setup-note.tsx` | Server. What the reader needs running, shown once per unit that has exercises |
| `src/components/quiz/quiz.tsx` | Client. The mastery loop |
| `src/components/quiz/gate.tsx` | Client. The locked screen, and the explicit skip |
| `src/components/progress-note.tsx` | Client. Where progress lives, and how to take it with you |
| `src/components/mdx/*` | `pre`, `callout`, `table`, borrowing the shapes `apps/docs` already settled |
| `mdx-components.tsx` | `useMDXComponents` |

**Content**, one directory per unit under `src/content/`:

```
src/content/00-the-last-twenty-percent/{unit.mdx,quiz.ts}
src/content/01-dns-does-not-tell-the-truth/{unit.mdx,quiz.ts}
...
src/content/08-publishing-a-contract/{unit.mdx,quiz.ts}
```

**Routes:**

```
src/app/page.tsx                  the cover, and where the reader left off
src/app/units/[slug]/page.tsx     one unit: MDX, exercises, quiz
src/app/exam/page.tsx             the final exam
src/app/progress/page.tsx         export, import, reset
```

## Design direction

The docs are a reference and look like one: restrained, dark, sans throughout,
a 16rem sidebar of links. A course is a different object. It has a beginning
and an end, it is read rather than consulted, and its units are long enough
that a sans body face at 14px is the wrong tool.

So: **a field manual for a system that lies to you.**

**Shared with docs, deliberately.** The background (`#0b0b0d`), `--muted`
(`#27272a`), and every severity token. A diagnosis code has to look identical in
both places or the reader learns two visual languages for one contract.

**Its own, deliberately.**

- **Type.** Instrument Serif for unit numbers and titles, high-contrast and
  editorial, unmistakably not a docs page. Newsreader for body prose at
  1.125rem on 1.75 leading, because a unit is two thousand words and a serif is
  the better tool for that. JetBrains Mono for all code, records, and diagnosis
  codes, which is the continuity anchor.
- **The spine.** A one-pixel vertical rule down the left with nine nodes,
  replacing the docs sidebar. The current node is filled; passed nodes are
  hollow; skipped nodes are hollow and dashed, permanently; locked nodes are
  dim. No numbers, no bar, no percentage. The reader's position is the only
  thing it reports.
- **One accent, and it is not a verdict colour.** A bone white (`#e8e4da`) for
  "you are here" and for the spine's filled node. Every colour in the severity
  set already means something specific, and an accent drawn from it would read
  as a verdict on the reader's progress.
- **The lookup block** is the thing someone remembers. Left rule, mono, the
  exact command on one line with a copy button, then the shape of the answer to
  expect, then a collapsed line that opens to say what to notice. It
  deliberately does not print the output. The point is that the reader runs it.
- **Motion, restrained.** The spine strokes itself once on first load, 600ms.
  Unit body staggers in at 40ms. Nothing else moves. A course about a system
  that fires false alarms should not celebrate at the reader.

## How gating works

Unit 0 is open. Unit N+1 opens when unit N's quiz is passed.

A quiz has no score. Questions go into a queue; a wrong answer shows its
explanation and its source, then goes to the back of the queue. The unit passes
when the queue is empty. Attempts are counted and shown, because that is honest,
but nothing depends on the number.

There is an escape hatch, because principle 6 says there always is. The locked
screen has a button that opens the unit anyway, and the unit is recorded as
`skipped` rather than `passed`. The spine renders those differently and keeps
doing so. Storing "skipped" as "passed" would be the course telling the same
kind of lie the product exists to avoid.

## Exercises

Every exercise is a real query against the fixture tier. Setup is
`git clone`, `pnpm install`, `pnpm dns:up`, and the exercises name the servers
from `FIXTURE_SERVERS` rather than hardcoding a loopback address.

Worth knowing before writing unit 1: `TESTING.md` records that **`dig` hides
truncation.** It retries over TCP when it sees TC and prints the retried answer,
so the `tc` flag never appears. Exercises about truncation use `dig +ignore`,
and the unit says why. That single detail is the whole lesson of the unit in
miniature: the tool everyone reaches for is quietly reinterpreting what came
back.

Fixtures each unit draws on:

| Unit | Fixtures |
|---|---|
| 1 | `nodata.test`, `negcache-high.test`, `negcache-low.test`, `wildcard.test`, `appended.test`, `txt-split.test`, `tcp.test`, `bogus-zone.test`, `insecure-island.test` |
| 2 | `root.zone` and the delegation chain, `healthy.test`, `decoy.test` for a genuine REFUSED |
| 3 | `spf.test` |
| 4 | `dkim.test`, `dmarc.test`, `reports.test`, `unauth-reports.test`, `mx.test`, `caa.test`, `inner.caa-child.test` |
| 5 | `ownership.test`, `cname.test`, `mismatch.test` |
| 6 | `split.test` and `divergent.test`, served differently by two authoritative servers |

Units 7 and 8 have no DNS exercises. Their exercises are reading the guard
specs and making one fail on purpose: add a diagnosis code with no fixture and
watch `coverage.spec.ts` go red, add a route with no SDK method and watch
`sdk-coverage.spec.ts` go red.

---

## Task 1: The app shell

- [ ] `apps/learn/package.json`, `next.config.ts`, `wrangler.jsonc`, `postcss.config.mjs`, `vitest.config.ts`, `tsconfig.json`, mirroring `apps/docs` and adjusting the domain and app name
- [ ] `src/app/globals.css`: Tailwind 4 `@theme inline`, severity tokens copied from `apps/docs/src/app/globals.css` verbatim, the bone accent added, the Shiki background override kept
- [ ] `src/app/layout.tsx`: Instrument Serif, Newsreader, JetBrains Mono via `next/font/google`; `scroll-padding-top`; focus-visible ring
- [ ] `src/lib/cn.ts`, `src/lib/shiki.ts`, `src/lib/slug.ts`
- [ ] `mdx-components.tsx` and `src/components/mdx/*`
- [ ] Add `@propgate/learn` to the CI build matrix in `.github/workflows`
- [ ] Verify: `pnpm --filter @propgate/learn build` emits `out/`

## Task 2: The curriculum model and its guard

- [ ] `src/lib/curriculum.ts`: the nine units with slug, number, title, blurb, `assumes` (what the reader should already have), and `hasExercises`
- [ ] `src/lib/curriculum.spec.ts`: slugs unique, numbers contiguous from zero, every unit has `unit.mdx` and `quiz.ts` on disk
- [ ] `src/lib/counts.ts` and its spec, reading `DIAGNOSIS_REGISTRY`, `REQUIREMENTS`, `FIXTURE_EXPECTATIONS`
- [ ] Nine `src/content/*/unit.mdx` stubs containing only a heading, so the guard passes before the prose exists

## Task 3: Progress

- [ ] `src/lib/progress.ts`: the versioned key, read/write/export/import/reset, and `unitStatus(curriculum, stored)` deriving locked / open / passed / skipped
- [ ] `src/lib/progress.spec.ts`: the round trip, an unknown version ignored rather than migrated, a passed unit opening the next, a skipped unit never becoming passed
- [ ] `src/components/progress-note.tsx` and `src/app/progress/page.tsx`: what is stored, where, and a JSON export

## Task 4: Quizzes

- [ ] `src/lib/quiz/types.ts`
- [ ] `src/lib/quiz/derived.ts`: fixture-to-code questions from `FIXTURE_EXPECTATIONS`, severity questions from `DIAGNOSIS_REGISTRY`, gap questions from the `not-implemented` entries in `REQUIREMENTS`
- [ ] `src/lib/quiz/derived.spec.ts` and `src/lib/quiz/authored.spec.ts`
- [ ] `src/components/quiz/quiz.tsx`: the mastery queue, explanation on a wrong answer, requeue, pass when empty
- [ ] `src/components/quiz/gate.tsx`: the locked screen and the recorded skip

## Task 5: The spine, the unit page, and the lookup block

- [ ] `src/components/spine.tsx` with the four node states and the one-time stroke
- [ ] `src/components/unit-header.tsx`, `src/components/setup-note.tsx`
- [ ] `src/components/lookup.tsx`: command, expected shape, collapsed reveal, copy button
- [ ] `src/app/units/[slug]/page.tsx` with `generateStaticParams` from the curriculum
- [ ] `src/app/page.tsx`: the cover, and resume-where-you-left-off

## Task 6: Units 0 to 2 — the problem, the lies, the resolver

- [ ] `00-the-last-twenty-percent/unit.mdx` and `quiz.ts`
- [ ] `01-dns-does-not-tell-the-truth/unit.mdx` and `quiz.ts`, with the nine fixture exercises
- [ ] `02-a-resolver-with-no-dependencies/unit.mdx` and `quiz.ts`, including reading a response's bytes by hand

## Task 7: Units 3 and 4 — the RFCs

- [ ] `03-spf-the-way-an-mta-reads-it/unit.mdx` and `quiz.ts`
- [ ] `04-keys-policies-and-trees/unit.mdx` and `quiz.ts`
- [ ] Both link to `docs.propgate.dev/conformance` for the ledger rather than restating it

## Task 8: Units 5 to 8 — the systems half

- [ ] `05-asking-the-right-question/unit.mdx` and `quiz.ts`
- [ ] `06-believing-a-failure/unit.mdx` and `quiz.ts`
- [ ] `07-the-parts-that-cost-money/unit.mdx` and `quiz.ts`
- [ ] `08-publishing-a-contract/unit.mdx` and `quiz.ts`, with the two make-a-guard-fail exercises

## Task 9: The exam, and the final pass

- [ ] `src/lib/quiz/exam.ts`: a deterministic sample across all nine units, same mastery rule
- [ ] `src/app/exam/page.tsx`
- [ ] A pass over every unit for the writing: no inflated significance, no rule-of-three padding, no bolded inline-header lists, no generic closing paragraph
- [ ] `docker-compose.yml` and `DEPLOYING.md` updated if the app is deployed alongside the others
- [ ] Link from `apps/docs` and `apps/web` once the content is real, and not before

---

## Self-review

- The curriculum guard is the same shape as `navigation.spec.ts`: a table joined
  to the filesystem, enforced by the test suite. That is deliberate. It is the
  pattern this repository already trusts.
- Deriving some quiz questions from the registries is the same argument as
  rendering the taxonomy from them. The authored questions are the part that
  cannot be derived, and the guard on them checks structure rather than truth,
  which is the honest limit.
- Nine units is a guess, not a measurement. The receipt would be somebody
  actually finishing it and saying where they stalled. Named here rather than
  quietly assumed.
- The exercises depend on `pnpm dns:up` working from a clean clone. Verify that
  before writing unit 1, not after.

## Unresolved questions

1. **`learn.propgate.dev` or `docs.propgate.dev/learn`?** Plan assumes a
   subdomain. A path under docs means one fewer deploy but a shared wrangler
   config and a route split.
2. **Does unit 2 teach the wire format from bytes, or from the reader's API?**
   Bytes is the real lesson and roughly doubles the unit's length.
3. **Exam on failure: reset the unit, or just the exam?** Plan assumes just the
   exam. Resetting units would be punitive for a course nobody is grading.
4. **Ship all nine before linking it, or publish unit by unit?** Plan assumes
   all nine, no public link until then.
5. **Is `apps/learn` in scope for the repo at all, given `packages/ui` was
   deliberately deferred?** Different argument — this is content, not a control
   plane — but the phasing discipline is the same and worth stating out loud.
