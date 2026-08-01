"use client";

import { ChevronRight } from "lucide-react";
import { useCallback, useState } from "react";
import {
  CHECK_LABELS,
  CHECK_QUESTIONS,
  type CheckOutcome,
  type Finding,
  recordTypeName,
} from "@/lib/check";
import { cn } from "@/lib/utils";
import { Rail, SeverityDot, verdictTone, verdictWord } from "./verdict";

/**
 * One check, and the evidence behind it.
 *
 * Every other DNS checker shows a verdict. The thing worth building here is the
 * layer underneath: what was observed, what was expected, and which queries
 * produced that. So evidence is always visible and only the query trail folds
 * away — the reasoning is the product, and hiding it behind a disclosure would
 * be hiding the part nobody else has.
 */

function EvidenceRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] gap-3">
      <dt className="text-muted-foreground text-xs uppercase tracking-wider">
        {label}
      </dt>
      <dd className="break-all font-mono text-foreground/90 text-xs">
        {value}
      </dd>
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const { evidence } = finding;
  const hasEvidence =
    evidence.observed !== undefined ||
    evidence.expected !== undefined ||
    evidence.name !== undefined;

  return (
    <li className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <SeverityDot severity={finding.severity} />

      <div className="min-w-0 flex-1 space-y-2.5">
        <p className="text-[0.9375rem] leading-relaxed">{finding.summary}</p>

        {evidence.detail === undefined ? null : (
          <p className="text-muted-foreground text-sm leading-relaxed">
            {evidence.detail}
          </p>
        )}

        {hasEvidence ? (
          <dl className="space-y-1.5 border-border border-l pl-4">
            {evidence.name === undefined ? null : (
              <EvidenceRow label="Name" value={evidence.name} />
            )}
            {evidence.observed === undefined ? null : (
              <EvidenceRow label="Found" value={evidence.observed} />
            )}
            {evidence.expected === undefined ? null : (
              <EvidenceRow label="Wanted" value={evidence.expected} />
            )}
          </dl>
        ) : null}

        <p className="font-mono text-[0.6875rem] text-muted-foreground/70 tracking-wide">
          {finding.code}
        </p>
      </div>
    </li>
  );
}

function LookupTrail({ lookups }: { lookups: CheckOutcome["lookups"] }) {
  return (
    <ol className="space-y-2 border-border border-l pl-4">
      {lookups.map((lookup, index) => (
        <li
          className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[auto_1fr]"
          key={`${lookup.name}-${lookup.type}-${index}`}
        >
          <p className="font-mono text-xs">
            <span className="text-muted-foreground">
              {recordTypeName(lookup.type)}
            </span>{" "}
            <span className="text-foreground/90">{lookup.name}</span>
          </p>
          <p className="text-muted-foreground text-xs sm:text-right">
            <span
              className={cn(
                lookup.status === "answered"
                  ? "text-muted-foreground"
                  : "text-warning"
              )}
            >
              {lookup.status}
            </span>{" "}
            <span className="text-muted-foreground/60">
              via {lookup.server}
            </span>
          </p>
          <p className="text-muted-foreground/70 text-xs sm:col-span-2">
            {lookup.purpose}
          </p>
        </li>
      ))}
    </ol>
  );
}

export function CheckPanel({
  index,
  outcome,
}: {
  index: number;
  outcome: CheckOutcome;
}) {
  const [showTrail, setShowTrail] = useState(false);
  const toggleTrail = useCallback(() => setShowTrail((open) => !open), []);

  return (
    <article
      className="flex animate-[rise_320ms_ease-out_both] gap-5"
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <Rail className="self-stretch" verdict={outcome.verdict} />

      <div className="min-w-0 flex-1 pb-10">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="font-medium text-lg tracking-tight">
            {CHECK_LABELS[outcome.kind]}
          </h2>
          <p
            className={cn(
              "font-mono text-xs uppercase tracking-widest",
              verdictTone(outcome.verdict)
            )}
          >
            {verdictWord(outcome.verdict)}
          </p>
        </header>

        <p className="mt-1 text-muted-foreground text-sm">
          {CHECK_QUESTIONS[outcome.kind]}
        </p>

        {outcome.findings.length > 0 ? (
          <ul className="mt-5 divide-y divide-border">
            {outcome.findings.map((finding) => (
              <FindingRow finding={finding} key={finding.code} />
            ))}
          </ul>
        ) : (
          <p className="mt-5 text-muted-foreground text-sm">
            Nothing to report.
          </p>
        )}

        {outcome.lookups.length > 0 ? (
          <div className="mt-5">
            <button
              className="group inline-flex items-center gap-1.5 font-mono text-muted-foreground text-xs tracking-wide transition-colors hover:text-foreground"
              onClick={toggleTrail}
              type="button"
            >
              <ChevronRight
                className={cn(
                  "size-3 transition-transform",
                  showTrail && "rotate-90"
                )}
              />
              {outcome.lookups.length}{" "}
              {outcome.lookups.length === 1 ? "query" : "queries"}
            </button>

            {showTrail ? (
              <div className="mt-3 animate-[rise_200ms_ease-out_both]">
                <LookupTrail lookups={outcome.lookups} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </article>
  );
}
