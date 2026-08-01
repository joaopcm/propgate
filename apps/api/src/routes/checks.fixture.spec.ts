import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { createApp } from "../app";

/**
 * The route against real servers.
 *
 * One round trip per shape of answer. The evaluators have their own specs; what
 * is being checked here is that a caller gets something they can render.
 */

const fixture = fixtureTarget("resolver");
const app = createApp({
  resolver: { address: fixture.address, port: fixture.port },
});

async function check(body: Record<string, unknown>) {
  const response = await app.request("/v1/checks", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

  return { body: await response.json(), status: response.status };
}

describe("a healthy customer domain", () => {
  it("returns a passing verdict in the envelope", async () => {
    const { body, status } = await check({
      dkimSelectors: ["pg1"],
      domain: "customer.test",
      expectsMail: false,
      spfInclude: "one.spf.test",
    });

    expect(status).toBe(200);
    expect(body.error).toBeNull();
    expect(body.data.verdict).toBe("pass");
    expect(body.data.object).toBe("check");
  });

  it("names the resolver it asked", async () => {
    // Which vantage point produced an answer is part of the answer, and becomes
    // the whole answer once there is more than one.
    const { body } = await check({ domain: "customer.test" });

    expect(body.meta.resolver).toBe(`${fixture.address}:${fixture.port}`);
  });

  it("carries each finding's summary and slug, not just its code", async () => {
    // Otherwise every consumer ships a copy of the taxonomy and keeps it in
    // step with ours.
    const { body } = await check({
      domain: "customer.test",
      expectsMail: false,
    });
    const [finding] = body.data.findings;

    expect(finding.code).toBe("MX_NULL");
    expect(finding.slug).toBe("mx-null");
    expect(finding.summary.length).toBeGreaterThan(20);
  });
});

describe("a domain that was never configured", () => {
  it("fails, with a finding per missing record", async () => {
    const { body } = await check({
      dkimSelectors: ["pg1"],
      domain: "nodata.test",
    });

    const codes = body.data.findings.map(
      (finding: { code: string }) => finding.code
    );

    expect(body.data.verdict).toBe("fail");
    expect(codes).toContain("SPF_RECORD_MISSING");
    expect(codes).toContain("DMARC_RECORD_MISSING");
  });

  it("keeps the derivation, per check", async () => {
    // "Why did you say that" is asked about one check at a time, so the lookups
    // stay grouped rather than flattened into one list.
    const { body } = await check({ checks: ["spf"], domain: "nodata.test" });
    const [spf] = body.data.checks;

    expect(spf.kind).toBe("spf");
    expect(spf.lookups[0].name).toBe("nodata.test");
    expect(spf.lookups[0].purpose.length).toBeGreaterThan(0);
    expect(spf.lookups[0].server).toBe(`${fixture.address}:${fixture.port}`);
    // The web client renders the record type and the outcome, so both are part
    // of the contract rather than incidental.
    expect(spf.lookups[0].type).toBe(16);
    expect(spf.lookups[0].status).toBe("answered");
  });

  it("reports how long the whole check took", async () => {
    // Rendered next to the verdict, so it is part of the response rather than
    // something a caller has to time themselves.
    const { body } = await check({ domain: "customer.test" });

    expect(typeof body.data.elapsedMs).toBe("number");
  });
});

describe("the profile decides what is a fault", () => {
  it("passes a null MX for a sending-only domain and fails it otherwise", async () => {
    const sending = await check({
      checks: ["mx"],
      domain: "customer.test",
      expectsMail: false,
    });
    const receiving = await check({
      checks: ["mx"],
      domain: "customer.test",
      expectsMail: true,
    });

    expect(sending.body.data.verdict).toBe("pass");
    expect(receiving.body.data.verdict).toBe("fail");
  });

  it("runs only the checks that were asked for", async () => {
    const { body } = await check({
      checks: ["spf", "dmarc"],
      domain: "customer.test",
    });

    expect(
      body.data.checks.map((entry: { kind: string }) => entry.kind)
    ).toEqual(["spf", "dmarc"]);
  });
});

describe("uncertainty reaches the caller as uncertainty", () => {
  it("is 200 with an indeterminate verdict, not a 5xx", async () => {
    // The request succeeded; the answer is that we could not tell. Returning an
    // error status would make a resolver blip look like a broken API.
    const unreachable = createApp({
      resolver: { address: "127.0.0.1", port: 1 },
    });

    const response = await unreachable.request("/v1/checks", {
      body: JSON.stringify({ checks: ["spf"], domain: "customer.test" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.verdict).toBe("indeterminate");
  });
});
