---
"@propgate/cli": minor
---

**Every API endpoint is now a command, and every command works two ways.**

The CLI reached 7 of the API's 22 endpoints. It now reaches all 22 — the whole
webhooks family, both profiles endpoints, `members list`, `domains
get`/`check`/`timeline`/`delete`, and `check --remote` for the public checker.
A spec asserts the parity in both directions, so a route without a command
fails a test rather than going unnoticed.

Each argument is declared once and drives both the flag and the prompt, so the
scripted path and the guided path cannot describe different things. Leave out a
required flag and, if there is a terminal to ask in, it asks:

```
$ propgate domains add example.com

│  Which profile should this domain satisfy?
│  sending
│
example.com registered as 019fcf7a-….
```

When there is nobody to ask it does not wait — it names every missing flag at
once and exits `64`. A CLI that blocks on stdin because a flag was missing hangs
a build until the runner's timeout with nothing saying why:

```
$ CI=true propgate domains add example.com
propgate: domains add needs --profile.
Pass it, or run in a terminal without --json for the guided flow.
```

Prompting is off when stdin or stdout is not a TTY, when `--json` is passed,
when `CI=true`, or when `PROPGATE_NO_INPUT=1`.

New and changed flags:

- `propgate check <domain> --remote` asks the API instead of resolving locally.
  Local stays the default: it answers from *your* resolver's point of view,
  which is usually the more useful answer when a customer reports something odd.
- `propgate profiles create` takes `--require '<key>:<check>[:field=value]'`,
  repeatable, or `--file` (with `-` for stdin). Field names are the API's own,
  unaliased, so a `422` names the word you typed.
- `domains list` gains `--external-id`, `--cursor` and `--limit`; it and
  `webhooks deliveries` gain `--all`, which follows the cursor to the end at the
  server's maximum page size.

Two commands do different things and the CLI keeps them apart. `propgate check`
reads DNS and writes nothing. `propgate domains check <id>` re-checks a
*registered* domain: it moves the domain's state, spends the per-tenant check
budget, and a transition there is what fires a webhook. So a domain id typed at
`propgate check` is redirected rather than routed, and nothing goes over the
wire either way:

```
$ propgate check 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a
propgate: that looks like a domain id, not a domain name.
Did you mean `propgate domains check 019fcf4f-2b3c-7d4e-9f5a-6b7c8d9e0f1a`?
```

**Two behaviour changes worth reading before upgrading.** A missing required
argument now exits **64** rather than `1`. `1` means the API said no; `64` means
the arguments were wrong and nothing was attempted, and a script could not tell
a typo from a rejection while both were `1`. A prompt cancelled with Ctrl-C
exits **130**. `--json` now implies no prompting everywhere.

`@propgate/cli` gains one dependency, `@clack/prompts`, for the guided flow. It
is loaded only when there is a person to prompt, so `propgate check` never
reaches it — and `@propgate/dns`, the resolver underneath, still has zero
runtime dependencies of its own.
