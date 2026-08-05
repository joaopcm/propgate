import { startTcpBlackhole } from "@propgate/dns-fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChecks } from "../check/run";
import { DiagnosisCode } from "../diagnosis/codes";
import { RecordType } from "../wire/constants";
import { query } from "./query";

/**
 * A truncated UDP answer whose TCP retry is swallowed.
 *
 * Against a real server on a real socket, speaking real DNS wire format — the
 * fixture is `startTcpBlackhole`, not a stub. What it cannot be is a zone: the
 * behaviour under test belongs to a middlebox rather than to any record, so `nsd`
 * has no way to express it. See that file for why a silent TCP listener stands in
 * for an iptables DROP, and what the substitution does and does not cover.
 *
 * Timing-bound, and the only such spec outside the fixture tier. Bounded at 150 ms
 * by an explicit `timeoutMs` and deterministic — the listener does not drop
 * packets probabilistically, it reliably says nothing — so this is slow-by-design
 * rather than flaky. That is the distinction `TESTING.md`'s one-blackhole rule is
 * actually drawing.
 */

/** Past the loopback round trip, far short of anything that would look hung. */
const TIMEOUT_MS = 150;
/** A high port, because nothing here is entitled to 53. */
const PORT = 15_353;
const ADDRESS = "127.0.0.1";

let blackhole: Awaited<ReturnType<typeof startTcpBlackhole>>;

beforeAll(async () => {
  blackhole = await startTcpBlackhole({ address: ADDRESS, port: PORT });
});

afterAll(async () => {
  await blackhole.close();
});

describe("a server that invites a TCP retry and swallows it", () => {
  it("times out over TCP, having answered over UDP", async () => {
    const outcome = await query({
      name: "selector._domainkey.blocked.test",
      target: { address: ADDRESS, port: PORT },
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    expect(outcome.status).toBe("timeout");
    // The transport matters: the UDP exchange succeeded, so a timeout attributed
    // to UDP would mean the fixture never set TC and the test proves nothing.
    expect(outcome.transport).toBe("tcp");
  });

  it("records that the timeout followed a truncated answer", async () => {
    const outcome = await query({
      name: "selector._domainkey.blocked.test",
      target: { address: ADDRESS, port: PORT },
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    // The whole basis of the diagnosis. Without this flag a swallowed retry is
    // indistinguishable from a server that was never there, which is why the code
    // was published and unreachable for two milestones.
    expect(outcome.status === "timeout" && outcome.retriedOverTcp).toBe(true);
  });

  it("does not claim a retry when TCP was asked for directly", async () => {
    const outcome = await query({
      name: "selector._domainkey.blocked.test",
      // Straight to TCP: no UDP answer, so no truncation, so no evidence that
      // anything is being blocked rather than merely absent.
      target: { address: ADDRESS, port: PORT, transport: "tcp" },
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    expect(outcome.status).toBe("timeout");
    expect(outcome.status === "timeout" && outcome.retriedOverTcp).toBe(false);
  });

  it("surfaces as TCP_SILENTLY_BLOCKED on a DKIM check", async () => {
    // The end of the chain, and what earns the code its place in the taxonomy: a
    // 2048-bit DKIM key is the record that forces the fallback in practice, so
    // DKIM is where a blocked retry is first felt.
    const result = await runChecks({
      domain: "blocked.test",
      profile: { checks: ["dkim"], dkimSelectors: ["selector"], id: "test" },
      resolver: {
        budgetMs: 2000,
        maxLookups: 10,
        recursionDesired: true,
        target: { address: ADDRESS, port: PORT },
        timeoutMs: TIMEOUT_MS,
      },
    });

    const codes = result.checks.flatMap((check) =>
      check.findings.map((finding) => finding.code)
    );

    expect(codes).toContain(DiagnosisCode.TCP_SILENTLY_BLOCKED);
  });

  it("reports the TC bit rather than retrying when told not to", async () => {
    const outcome = await query({
      name: "selector._domainkey.blocked.test",
      retryOverTcp: false,
      target: { address: ADDRESS, port: PORT },
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    // Confirms the fixture really is setting TC, independently of the timeout
    // path — otherwise every assertion above could pass for the wrong reason.
    expect(outcome.status).toBe("truncated");
    expect(outcome.transport).toBe("udp");
  });
});
