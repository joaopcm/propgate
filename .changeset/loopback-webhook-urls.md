---
"@propgate/cli": patch
---

`webhooks create` accepts an `http://` URL on loopback.

The https rule is a statement about a network, and loopback has none — the same
line browsers draw when they treat `http://127.0.0.1` as a secure context.
Refusing it client-side meant the CLI could never register a receiver against a
self-hosted API, because the check runs before any request is made and the CLI
has no way to know what the server on the other end permits. api.propgate.dev
still refuses loopback outright, so nothing changes for anyone pointed at us:
the final say moves to the server, which is the only side that knows.
