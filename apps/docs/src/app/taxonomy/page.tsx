import { DIAGNOSIS_REGISTRY, NOT_LOCALLY_REPRODUCIBLE } from "@propgate/dns";
import { FIXTURE_EXPECTATIONS } from "@propgate/dns-fixtures";
import type { Metadata } from "next";

/**
 * The published taxonomy renders from the same two sources the test suite reads:
 * DIAGNOSIS_REGISTRY in @propgate/dns and FIXTURE_EXPECTATIONS in
 * @propgate/dns-fixtures. That is the point — documentation generated from the
 * test matrix cannot drift away from it, and "which fixture proves this?" is
 * answerable from the public page.
 */

export const metadata: Metadata = {
  description:
    "Every DNS misconfiguration propgate detects, what it means, and which fixture proves it.",
  title: "Diagnosis taxonomy",
};

const SEVERITY_STYLES = {
  error: "text-[--color-destructive]",
  info: "text-muted-foreground",
  warning: "text-[--color-warning]",
} as const;

function fixturesFor(code: string): string[] {
  return FIXTURE_EXPECTATIONS.filter((row) => row.codes.includes(code)).map(
    (row) => row.zone
  );
}

export default function TaxonomyPage() {
  const codes = Object.values(DIAGNOSIS_REGISTRY);

  return (
    <>
      <h1 className="mb-6 font-semibold text-3xl tracking-tight">
        Diagnosis taxonomy
      </h1>
      <p className="mb-10 text-muted-foreground leading-7">
        Every code is a stable public contract. Switching on one is supported;
        we treat changing or removing one as a breaking change.
      </p>

      {codes.map((definition) => {
        const fixtures = fixturesFor(definition.code);
        const unreproducible = NOT_LOCALLY_REPRODUCIBLE[definition.code];

        return (
          <section className="mb-10" id={definition.slug} key={definition.code}>
            <h2 className="mb-1 font-mono text-lg tracking-tight">
              {definition.code}
            </h2>
            <p
              className={`mb-2 text-xs uppercase ${SEVERITY_STYLES[definition.severity]}`}
            >
              {definition.severity}
            </p>
            <p className="mb-2 text-muted-foreground leading-7">
              {definition.summary}
            </p>
            {fixtures.length > 0 ? (
              <p className="text-muted-foreground text-sm">
                Verified against{" "}
                {fixtures.map((zone) => (
                  <code
                    className="mr-1 rounded bg-white/5 px-1.5 py-0.5 font-mono text-xs"
                    key={zone}
                  >
                    {zone}
                  </code>
                ))}
              </p>
            ) : null}
            {unreproducible ? (
              <p className="text-muted-foreground text-sm">
                <strong>Not reproducible in our test harness.</strong>{" "}
                {unreproducible}
              </p>
            ) : null}
          </section>
        );
      })}
    </>
  );
}
