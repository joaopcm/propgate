import { Checker } from "@/components/checker";

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

      <footer className="mt-24 border-border border-t pt-8 text-muted-foreground/60 text-xs leading-relaxed">
        <p>
          Nothing is stored. Every check runs against live DNS at the moment you
          ask, and the queries behind each answer are listed with it.
        </p>
      </footer>
    </main>
  );
}
