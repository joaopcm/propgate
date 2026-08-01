import { coverageByRfc, percentage, summary } from "@propgate/dns";
import type { Metadata } from "next";

/**
 * The conformance ledger, published.
 *
 * Rendered from the same table the test suite enforces, so the figure here is
 * the figure the build proved. The gap list is deliberately as prominent as the
 * percentage: a consumer deciding whether to trust this library needs the list
 * of what it does not do far more than a number.
 */

export const metadata: Metadata = {
  description:
    "Which normative RFC requirements propgate implements, which it does not, and why.",
  title: "RFC conformance",
};

const STATUS_STYLE = {
  implemented: "text-[var(--color-success)]",
  "not-applicable": "text-muted-foreground/60",
  "not-implemented": "text-[var(--color-warning)]",
} as const;

const STATUS_LABEL = {
  implemented: "yes",
  "not-applicable": "n/a",
  "not-implemented": "no",
} as const;

export default function ConformancePage() {
  const totals = summary();
  const rfcs = coverageByRfc();

  return (
    <>
      <h1 className="mb-6 font-semibold text-3xl tracking-tight">
        RFC conformance
      </h1>

      <p className="mb-4 text-lg leading-8">
        {totals.implemented} of {totals.applicable} catalogued requirements —{" "}
        {percentage(totals.implemented, totals.applicable)}%.
      </p>

      <p className="mb-4 text-muted-foreground leading-7">
        The denominator is our reading of which normative statements apply to a
        verifier: something that inspects a domain&apos;s records and reports on
        them. It is not a percentage of an RFC&apos;s text, which is not a
        computable number — most of RFC 7208 instructs senders and receiving
        MTAs, and none of that is ours to implement. Requirements that do not
        apply are listed below with a reason and excluded from the denominator,
        so cataloguing more of what an MTA does cannot improve the figure.
      </p>

      <p className="mb-12 text-muted-foreground leading-7">
        Every requirement marked <em>yes</em> names a test that must exist and
        must assert it. The build fails otherwise, so the number is checkable
        rather than claimed.
      </p>

      <section className="mb-14">
        <h2 className="mb-4 font-medium text-xl tracking-tight">
          What we do not do
        </h2>
        <p className="mb-6 text-muted-foreground text-sm leading-6">
          The part of this page worth reading first.
        </p>

        <ul className="space-y-5">
          {totals.gaps.map((gap) => (
            <li key={`${gap.rfc}-${gap.section}-${gap.requirement}`}>
              <p className="font-mono text-sm">
                RFC {gap.rfc} §{gap.section}
              </p>
              <p className="mt-1 leading-7">{gap.requirement}</p>
              <p className="mt-1 text-muted-foreground text-sm leading-6">
                {gap.note}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {rfcs.map((rfc) => (
        <section className="mb-14" id={`rfc-${rfc.rfc}`} key={rfc.rfc}>
          <h2 className="font-medium text-xl tracking-tight">
            <a
              className="hover:underline"
              href={`https://www.rfc-editor.org/rfc/rfc${rfc.rfc}`}
              rel="noreferrer"
              target="_blank"
            >
              RFC {rfc.rfc}
            </a>
          </h2>
          <p className="mt-1 text-muted-foreground text-sm">{rfc.title}</p>
          <p className="mt-1 font-mono text-muted-foreground/70 text-xs uppercase tracking-widest">
            {rfc.implemented} / {rfc.applicable} implemented
            {rfc.notApplicable > 0
              ? ` · ${rfc.notApplicable} not applicable`
              : ""}
          </p>

          <ul className="mt-5">
            {rfc.requirements.map((entry) => (
              <li
                className="flex gap-4 border-white/5 border-b py-3 last:border-0"
                key={`${entry.section}-${entry.requirement}`}
              >
                <span className="w-12 shrink-0 font-mono text-muted-foreground text-xs">
                  §{entry.section}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-6">{entry.requirement}</p>
                  {entry.note === undefined ? null : (
                    <p className="mt-1 text-muted-foreground text-sm leading-6">
                      {entry.note}
                    </p>
                  )}
                </div>

                <span
                  className={`w-8 shrink-0 text-right font-mono text-xs ${STATUS_STYLE[entry.status]}`}
                >
                  {STATUS_LABEL[entry.status]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
