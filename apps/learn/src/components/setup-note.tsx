import { FIXTURE_SERVERS } from "@propgate/dns-fixtures";

/**
 * What a reader needs running before the exercises in this unit work.
 *
 * Shown once, at the top, on the units that have queries in them. The
 * alternative — a note on every `Lookup` — is the kind of repetition that
 * trains people to skip the thing they most need to read.
 *
 * The macOS caveat is here rather than in the units because it is a property of
 * the machine, not of the lesson. Only `127.0.0.1` is up on Darwin, so the
 * compose override publishes high ports on loopback instead of using distinct
 * addresses, and every command in the unit needs different numbers. Saying so
 * once is the difference between a reader adjusting and a reader concluding the
 * fixtures are broken.
 */
export function SetupNote() {
  return (
    <aside className="my-8 border-border border-y py-4 text-sm leading-7">
      <p className="font-mono text-[0.6875rem] text-muted-foreground uppercase tracking-widest">
        Before the exercises
      </p>
      <p className="mt-2 text-muted-foreground">
        The queries in this unit go to a real authoritative server, not a
        simulation. Clone{" "}
        <a
          className="text-foreground underline underline-offset-4"
          href="https://github.com/joaopcm/propgate"
        >
          joaopcm/propgate
        </a>
        , then <code className="font-mono text-foreground">pnpm install</code>{" "}
        and <code className="font-mono text-foreground">pnpm dns:up</code>. That
        brings up {Object.keys(FIXTURE_SERVERS).length} servers on separate
        loopback addresses: two Unbound resolvers, one validating and one not,
        and the rest authoritative.
      </p>
      <p className="mt-2 text-muted-foreground">
        The addresses printed below assume Linux. On macOS only{" "}
        <code className="font-mono text-foreground">127.0.0.1</code> is up, so
        the compose override publishes high ports on it instead — use{" "}
        <code className="font-mono text-foreground">
          docker-compose.darwin.yml
        </code>{" "}
        and read the real ports out of{" "}
        <code className="font-mono text-foreground">docker compose ps</code>.
      </p>
      <p className="mt-2 text-muted-foreground">
        You can read the unit without any of this. You cannot learn the unit
        without it, which is the reason the course does not ship a fake
        resolver.
      </p>
    </aside>
  );
}
