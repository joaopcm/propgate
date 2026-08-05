/**
 * Every sample here is checked against the real exports of `@propgate/dns` —
 * see the task report for how. None of these are captured output; the shapes
 * come from `packages/dns/src/transport/{query,types}.ts`.
 */

export const RESOLVER_QUERY_BASIC = `import { query, RecordType } from "@propgate/dns";

const outcome = await query({
  target: { address: "8.8.8.8", port: 53 },
  name: "example.com",
  type: RecordType.A,
});

if (outcome.status === "answered") {
  console.log(outcome.message.answers.length, "records over", outcome.transport);
}`;

export const RESOLVER_OUTCOME_SWITCH = `import { query, RecordType } from "@propgate/dns";

const outcome = await query({
  target: { address: "8.8.8.8", port: 53 },
  name: "example.com",
  type: RecordType.A,
});

// Every branch is something a caller can act on. A single catch around this
// would have to guess which of these five actually happened.
switch (outcome.status) {
  case "answered":
    console.log("answered over", outcome.transport, "in", outcome.elapsedMs, "ms");
    break;
  case "timeout":
    console.log(outcome.retriedOverTcp ? "TCP retry never came back" : "no answer in time");
    break;
  case "unreachable":
    console.log(outcome.code, outcome.detail);
    break;
  case "malformed":
    console.log("could not decode:", outcome.reason, "at byte", outcome.offset);
    break;
  case "truncated":
    console.log("truncated over UDP, not retried:", outcome.message.flags.tc);
    break;
}`;

export const RESOLVER_PORT_AWARE = `import { query, RecordType } from "@propgate/dns";

// Nothing here assumes port 53. A resolver container, a split-horizon test
// rig, or a nameserver running on an alternate port is the same call.
const outcome = await query({
  target: { address: "127.0.0.1", port: 8053, transport: "udp" },
  name: "example.com",
  type: RecordType.A,
});`;

export const RESOLVER_TRUNCATION = `import { query, RecordType } from "@propgate/dns";

// Omitting ednsBufferSize sends no OPT record at all, which caps the answer
// at 512 bytes by RFC 1035 — the only way to drive truncation from the
// client rather than by tuning the server.
const truncated = await query({
  target: { address: "198.51.100.1", port: 53 },
  name: "big-key._domainkey.example.com",
  type: RecordType.TXT,
  retryOverTcp: false,
});

if (truncated.status === "truncated") {
  console.log("TC bit set:", truncated.message.flags.tc);
}`;

export const RESOLVER_TCP_SILENTLY_BLOCKED = `import { DiagnosisCode, query, RecordType } from "@propgate/dns";

// By default a truncated UDP answer is retried over TCP automatically.
const outcome = await query({
  target: { address: "198.51.100.1", port: 53 },
  name: "big-key._domainkey.example.com",
  type: RecordType.TXT,
});

// retriedOverTcp on a timeout means the *retry* is what timed out, not the
// first exchange — this server already answered over UDP and asked for TCP,
// which means it is alive. A bare TCP timeout can't tell you that; this can.
// It is exactly the shape the evaluators report as TCP_SILENTLY_BLOCKED.
if (outcome.status === "timeout" && outcome.retriedOverTcp) {
  console.log(DiagnosisCode.TCP_SILENTLY_BLOCKED, "— alive over UDP, silent over TCP");
}`;
