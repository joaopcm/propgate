import Link from "next/link";
import { StartLink } from "@/components/start-link";
import { UnitIndex } from "@/components/unit-index";
import {
  applicableRequirementCount,
  diagnosisCodeCount,
  fixtureZoneCount,
  gapCount,
  rfcCount,
} from "@/lib/counts";

export default function CoverPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-20 sm:py-28 lg:px-10">
      <header className="rise-in">
        <p className="font-mono text-[0.6875rem] text-muted-foreground/60 uppercase tracking-[0.2em]">
          propgate / course
        </p>
        <h1 className="mt-6 max-w-3xl text-balance font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">
          Anyone can verify a domain in two weeks. The last 20% takes two years.
        </h1>
        <p className="mt-8 max-w-[38rem] text-[1.0625rem] text-foreground/85 leading-[1.75]">
          Every product that asks a customer to add DNS records builds the same
          system, and most of them build the easy 80%: query the name, compare
          the string, show a green tick. Then the tickets start. The record is
          there but the provider appended the zone name to it. The tick is green
          because a wildcard answers every query. The customer deleted the key
          on Tuesday and nobody noticed until Friday.
        </p>
        <p className="mt-5 max-w-[38rem] text-[1.0625rem] text-foreground/85 leading-[1.75]">
          This course is about that 20%. It works through a real implementation
          ({diagnosisCodeCount()} diagnosis codes,{" "}
          {applicableRequirementCount()} catalogued requirements across{" "}
          {rfcCount()} RFCs, of which {gapCount()} are openly recorded as not
          done) and every query you run goes to {fixtureZoneCount()} real zones
          on a real authoritative server, because a mocked resolver agrees with
          whatever you believed when you wrote the mock.
        </p>
        <StartLink />
      </header>

      <section className="mt-24">
        <h2 className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-[0.2em]">
          Nine units
        </h2>
        <UnitIndex />
      </section>

      <section className="mt-20 grid gap-10 border-border border-t pt-10 sm:grid-cols-3">
        <div>
          <h3 className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest">
            What you need
          </h3>
          <p className="mt-3 text-muted-foreground text-sm leading-7">
            A terminal, Docker, and <code className="font-mono">dig</code>. The
            units read fine without them; the exercises do not work without
            them, and the exercises are the part that sticks.
          </p>
        </div>
        <div>
          <h3 className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest">
            How it is gated
          </h3>
          <p className="mt-3 text-muted-foreground text-sm leading-7">
            Each unit ends in questions, and every one has to be right before
            the next unit opens. No score, no percentage, unlimited retries. If
            you already know a unit, there is a button that says so.
          </p>
        </div>
        <div>
          <h3 className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest">
            Where progress goes
          </h3>
          <p className="mt-3 text-muted-foreground text-sm leading-7">
            Your browser, under one key, sent nowhere. There is nothing to sign
            up for.{" "}
            <Link className="underline underline-offset-4" href="/progress">
              Export it
            </Link>{" "}
            if you care about keeping it.
          </p>
        </div>
      </section>

      <footer className="mt-24 space-y-3 border-border border-t pt-8 text-muted-foreground/60 text-xs leading-relaxed">
        <p>
          The implementation this teaches is{" "}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href="https://github.com/joaopcm/propgate"
          >
            joaopcm/propgate
          </a>
          . The resolver and the taxonomy are MIT and have no runtime
          dependencies; the fixture zones are in the same repository.
        </p>
        <p>
          Where the course would otherwise restate a reference, it links to one:{" "}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href="https://docs.propgate.dev/taxonomy"
          >
            the taxonomy
          </a>{" "}
          and{" "}
          <a
            className="underline underline-offset-2 hover:text-foreground"
            href="https://docs.propgate.dev/conformance"
          >
            the RFC ledger
          </a>{" "}
          are generated from the code, and are the current answer rather than
          the answer as of when this was written.
        </p>
      </footer>
    </div>
  );
}
