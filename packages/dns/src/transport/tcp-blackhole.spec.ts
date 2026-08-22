import { startTcpBlackhole } from "@propgate/dns-fixtures";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runChecks } from "../check/run";
import { DiagnosisCode } from "../diagnosis/codes";
import { RecordType } from "../wire/constants";
import { query } from "./query";

const TIMEOUT_MS = 150;
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
    expect(outcome.transport).toBe("tcp");
  });

  it("records that the timeout followed a truncated answer", async () => {
    const outcome = await query({
      name: "selector._domainkey.blocked.test",
      target: { address: ADDRESS, port: PORT },
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    expect(outcome.status === "timeout" && outcome.retriedOverTcp).toBe(true);
  });

  it("does not claim a retry when TCP was asked for directly", async () => {
    const outcome = await query({
      name: "selector._domainkey.blocked.test",
      target: { address: ADDRESS, port: PORT, transport: "tcp" },
      timeoutMs: TIMEOUT_MS,
      type: RecordType.TXT,
    });

    expect(outcome.status).toBe("timeout");
    expect(outcome.status === "timeout" && outcome.retriedOverTcp).toBe(false);
  });

  it("surfaces as TCP_SILENTLY_BLOCKED on a DKIM check", async () => {
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

    expect(outcome.status).toBe("truncated");
    expect(outcome.transport).toBe("udp");
  });
});
