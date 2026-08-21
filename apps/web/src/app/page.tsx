import { Checker } from "@/components/checker";
import { SiteFooter } from "@/components/site-frame";
import { env } from "@/env";
import { HOME_FOOTER, HOME_H1, HOME_LEAD } from "@/lib/site";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-20 sm:py-28">
      <header className="mb-14">
        <p className="font-mono text-muted-foreground/60 text-xs uppercase tracking-[0.2em]">
          propgate
        </p>
        <h1 className="mt-4 text-balance font-semibold text-3xl leading-tight tracking-tight sm:text-4xl">
          {HOME_H1}
        </h1>
        <p className="mt-6 max-w-2xl text-muted-foreground text-sm leading-relaxed">
          {HOME_LEAD}
        </p>
      </header>

      <Checker />

      <section className="mt-24 space-y-4 border-border border-t pt-8 text-muted-foreground/60 text-xs leading-relaxed">
        {HOME_FOOTER.split("\n\n").map((paragraph) => (
          <p key={paragraph.slice(0, 48)}>{paragraph}</p>
        ))}
        <p>
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
      </section>

      <SiteFooter className="mt-8 border-0 pt-0" />
    </main>
  );
}
