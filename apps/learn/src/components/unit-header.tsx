import type { Unit } from "@/lib/curriculum";

export function UnitHeader({ index, unit }: { index: number; unit: Unit }) {
  return (
    <header className="rise-in mb-10">
      <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-[0.2em]">
        Unit {String(index).padStart(2, "0")}
      </p>
      <h1 className="mt-3 text-balance font-display text-4xl leading-[1.1] tracking-tight sm:text-5xl">
        {unit.title}
      </h1>
      <p className="mt-4 max-w-2xl text-base text-muted-foreground leading-7">
        {unit.blurb}
      </p>
      <p className="mt-4 border-border border-t pt-4 text-muted-foreground/70 text-sm">
        <span className="font-mono text-[0.6875rem] uppercase tracking-widest">
          Assumes
        </span>{" "}
        {unit.assumes}
      </p>
    </header>
  );
}
