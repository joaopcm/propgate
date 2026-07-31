import { fixtureTarget } from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";
import { query } from "../transport/query";
import type { ServerAddress } from "../types";
import { RecordType } from "../wire/constants";
import { recordsOfType } from "../wire/message";
import { getRegistrableDomain } from "./index";

/**
 * The PSL against the fixture zones, joining the lookup to a real DNS answer.
 *
 * The unit specs prove the algorithm against publicsuffix.org's vectors. What
 * they cannot show is the thing that actually matters: that querying the
 * organizational domain finds a DMARC record while querying the name itself does
 * not. `zones/psl/example.co.uk.zone` exists for exactly this, since `.test`
 * cannot model a multi-label public suffix.
 */

const TIMEOUT_MS = 2000;

function auth(): ServerAddress {
  const fixture = fixtureTarget("auth");
  return { address: fixture.address, port: fixture.port };
}

async function txt(name: string): Promise<string[]> {
  const outcome = await query({
    name,
    target: auth(),
    timeoutMs: TIMEOUT_MS,
    type: RecordType.TXT,
  });

  if (outcome.status !== "answered") {
    throw new Error(`expected an answer for ${name}, got ${outcome.status}`);
  }

  return recordsOfType(outcome.message.answers, "TXT").map(
    (record) => record.rdata.value
  );
}

describe("DMARC lookup at the organizational domain", () => {
  it("finds the policy via the org domain of a multi-label public suffix", async () => {
    const queried = "sub.example.co.uk";
    const org = getRegistrableDomain(queried);

    // The whole point: co.uk is the public suffix, so PSL+1 is example.co.uk.
    // Counting labels would give co.uk and read a policy belonging to nobody.
    expect(org).toBe("example.co.uk");

    const [policy] = await txt(`_dmarc.${org}`);
    expect(policy).toContain("v=DMARC1");
    expect(policy).toContain("p=reject");
    expect(policy).toContain("sp=quarantine");
  });

  it("has distinct policies at the subdomain and the org domain", async () => {
    // Correcting an earlier version of this comment, which had the discovery
    // order backwards. RFC 7489 §6.6.3 queries the *exact* name first; the
    // organizational domain is only a fallback when that returns nothing. So a
    // subdomain publishing its own _dmarc is authoritative for itself, and the
    // org domain's sp= governs only subdomains that publish none.
    //
    // Both records exist here precisely so the evaluator's discovery order is
    // observable: see dmarc.fixture.spec.ts, which asserts which one wins.
    const [atSubdomain] = await txt("_dmarc.sub.example.co.uk");
    expect(atSubdomain).toContain("p=none");

    const [atOrg] = await txt("_dmarc.example.co.uk");
    expect(atOrg).toContain("p=reject");
    expect(atOrg).toContain("sp=quarantine");

    expect(atSubdomain).not.toBe(atOrg);
  });

  it("never falls back past the org domain to the public suffix", () => {
    // The fallback stops at PSL+1. There is deliberately no _dmarc.co.uk in the
    // fixtures, and there must never be a lookup for one.
    expect(getRegistrableDomain("_dmarc.co.uk")).toBe("_dmarc.co.uk");
    expect(getRegistrableDomain("co.uk")).toBeNull();
  });
});

describe("the private section against a real zone", () => {
  it("treats user.github.io as its own organizational domain", async () => {
    const org = getRegistrableDomain("user.github.io");

    expect(org).toBe("user.github.io");

    // The zone answers at that name, which is what makes the PSL answer
    // actionable rather than theoretical.
    const outcome = await query({
      name: org ?? "",
      target: auth(),
      timeoutMs: TIMEOUT_MS,
      type: RecordType.CAA,
    });

    if (outcome.status !== "answered") {
      throw new Error(`expected an answer, got ${outcome.status}`);
    }

    const caa = recordsOfType(outcome.message.answers, "CAA");
    expect(
      caa.map((record) => record.rdata.tag).sort((a, b) => a.localeCompare(b))
    ).toEqual(["issue", "issuewild"]);
  });

  it("is not what bounds CAA climbing — a second correction", () => {
    // An earlier version of this test claimed the organizational domain was the
    // floor for CAA tree climbing. It is not. RFC 8659 §3: "The search for a CAA
    // RRset climbs the DNS name tree from the specified label up to, but not
    // including, the DNS root." The PSL plays no part in CAA whatsoever.
    //
    // The intuition behind the mistake was about ownership — a policy at
    // github.io belongs to GitHub — and that much is true. But CAA deliberately
    // lets a parent bind its children, which is precisely how a platform
    // restricts which CAs may issue for the names it hands out.
    //
    // The org domain is still exactly right for DMARC, which is what this file
    // is otherwise about. See caa.fixture.spec.ts for the climb itself.
    expect(getRegistrableDomain("pages.user.github.io")).toBe("user.github.io");
    expect(getRegistrableDomain("github.io")).toBeNull();
  });
});
