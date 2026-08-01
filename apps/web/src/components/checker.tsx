"use client";

import { ArrowRight, Loader2 } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { byUrgency, type CheckResult, runCheck, summarise } from "@/lib/check";
import { cn } from "@/lib/utils";
import { CheckPanel } from "./check-panel";
import { Rail, verdictTone, verdictWord } from "./verdict";

/**
 * The public checker.
 *
 * One field, because anything else asked of a stranger is a reason to leave.
 * Everything the API can be told — selectors, the platform's include, whether
 * the domain receives mail — is a profile decision that belongs to an
 * onboarding flow, not to someone typing a domain to see what happens. So this
 * asks for none of it and reads the domain as it is.
 */

type State =
  | { readonly kind: "idle" }
  | { readonly kind: "running"; readonly domain: string }
  | { readonly kind: "done"; readonly result: CheckResult }
  | { readonly kind: "failed"; readonly message: string };

export function Checker() {
  const [domain, setDomain] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const inFlight = useRef<AbortController | null>(null);

  const running = state.kind === "running";

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();

      const trimmed = domain.trim();

      if (trimmed === "" || running) {
        return;
      }

      // A second submission replaces the first rather than racing it, so a
      // slow answer can never overwrite a newer one.
      inFlight.current?.abort();

      const controller = new AbortController();

      inFlight.current = controller;
      setState({ domain: trimmed, kind: "running" });

      const response = await runCheck({ domain: trimmed }, controller.signal);

      if (controller.signal.aborted) {
        return;
      }

      setState(
        response.ok
          ? { kind: "done", result: response.result }
          : { kind: "failed", message: response.message }
      );
    },
    [domain, running]
  );

  const onDomainChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setDomain(event.target.value),
    []
  );

  return (
    <div className="w-full">
      <form className="group relative" onSubmit={submit}>
        <label className="sr-only" htmlFor="domain">
          Domain
        </label>

        <div className="flex items-center gap-3 border-border border-b pb-4 transition-colors focus-within:border-foreground/30">
          <span
            aria-hidden="true"
            className="font-mono text-muted-foreground/50 text-xl"
          >
            /
          </span>

          <input
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-xl outline-none placeholder:text-muted-foreground/40 sm:text-2xl"
            id="domain"
            name="domain"
            onChange={onDomainChange}
            placeholder="example.com"
            spellCheck={false}
            value={domain}
          />

          <button
            aria-label="Check this domain"
            className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground disabled:opacity-40"
            disabled={running || domain.trim() === ""}
            type="submit"
          >
            {running ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
          </button>
        </div>
      </form>

      <div className="mt-16">
        {state.kind === "idle" ? <Idle /> : null}
        {state.kind === "running" ? <Running domain={state.domain} /> : null}
        {state.kind === "failed" ? <Failed message={state.message} /> : null}
        {state.kind === "done" ? <Report result={state.result} /> : null}
      </div>
    </div>
  );
}

function Idle() {
  return (
    <p className="max-w-lg text-muted-foreground text-sm leading-relaxed">
      Six checks — nameservers, SPF, DKIM, DMARC, mail delivery, certificate
      authorities — and every DNS query behind them, so you can see how the
      answer was reached rather than being asked to trust it.
    </p>
  );
}

function Running({ domain }: { domain: string }) {
  return (
    <div className="flex gap-5">
      <Rail className="self-stretch" running verdict="indeterminate" />
      <p className="py-1 font-mono text-muted-foreground text-sm">
        resolving {domain}
      </p>
    </div>
  );
}

function Failed({ message }: { message: string }) {
  return (
    <div className="flex gap-5">
      <Rail className="self-stretch" verdict="fail" />
      <div className="py-1">
        <p className="text-sm">{message}</p>
        <p className="mt-1 text-muted-foreground text-sm">
          This says nothing about the domain — only that the check did not run.
        </p>
      </div>
    </div>
  );
}

function Report({ result }: { result: CheckResult }) {
  // Worst first: the thing to fix belongs at the top, and the rest is
  // reference material for whoever scrolls.
  const ordered = [...result.checks].sort(byUrgency);

  return (
    <div>
      <header className="mb-12 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-border border-b pb-6">
        <div>
          <p className="font-mono text-lg">{result.domain}</p>
          <p
            className={cn(
              "mt-1 text-sm",
              result.verdict === "pass"
                ? "text-muted-foreground"
                : verdictTone(result.verdict)
            )}
          >
            {summarise(result)}
          </p>
        </div>

        <p className="font-mono text-muted-foreground/60 text-xs uppercase tracking-widest">
          {verdictWord(result.verdict)} · {result.elapsedMs}ms
        </p>
      </header>

      <div>
        {ordered.map((outcome, index) => (
          <CheckPanel index={index} key={outcome.kind} outcome={outcome} />
        ))}
      </div>
    </div>
  );
}
