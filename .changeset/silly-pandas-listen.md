---
"@propgate/cli": patch
---

**Fix the CLI doing nothing at all when run through its `bin`.**

`npx @propgate/cli check example.com` — the invocation in the README — exited 0
and printed nothing. So did every other command. This affected `0.1.0`, `0.1.1`,
`0.1.2` and `0.2.0`: every version ever published.

The entry guard asked whether `process.argv[1]` ended in `index.js`, to stay
importable from specs. But npm installs a package's bin as a symlink —
`.bin/propgate` → `dist/index.js` — and Node reports `argv[1]` as the path it was
invoked by rather than the file that path resolves to. Through the symlink the
guard saw `.../.bin/propgate`, concluded it was being imported, and skipped
`main()` entirely.

It compares realpaths now, which holds for the POSIX symlink, for
`node dist/index.js` with a relative path, and for the Windows `.cmd` shim.

Nothing else changed. Running `node dist/index.js` directly always worked, which
is why this survived four releases and a green suite — so the regression test
invokes the built binary **through a symlink**, the one shape nothing covered.
