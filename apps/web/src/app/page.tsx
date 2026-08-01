import { Checker } from "@/components/checker";
import { env } from "@/env";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-20 sm:py-28">
      <header className="mb-14">
        <p className="font-mono text-muted-foreground/60 text-xs uppercase tracking-[0.2em]">
          propgate
        </p>
        <h1 className="mt-4 text-balance font-semibold text-3xl leading-tight tracking-tight sm:text-4xl">
          What is actually wrong with this domain?
        </h1>
      </header>

      <Checker />

      <footer className="mt-24 space-y-2 border-border border-t pt-8 text-muted-foreground/60 text-xs leading-relaxed">
        <p>
          Nothing is stored. Every check runs against live DNS at the moment you
          ask, and the queries behind each answer are listed with it.
        </p>
        <p>
          {/* Deliberately a footnote. Someone checking a domain does not care
              which RFC clauses we implement — but someone deciding whether to
              build on the library does, and this is where they will look. */}
          The checks are the same ones in{" "}
          <a
            className="underline decoration-transparent underline-offset-2 transition-colors hover:text-foreground hover:decoration-current"
            href={`${env.NEXT_PUBLIC_DOCS_URL}/conformance`}
            rel="noreferrer"
            target="_blank"
          >
            @propgate/dns
          </a>
          , which publishes what it implements of each RFC and what it does not.
        </p>
      </footer>
    </main>
  );
}
