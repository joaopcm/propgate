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

  it("would miss the policy if it queried the subdomain's own _dmarc", async () => {
    // The subdomain does have a _dmarc record in the fixture, and DMARC says to
    // ignore it in favour of the org domain's policy plus sp=. Asserting both
    // records exist is what makes "we read the right one" a real claim.
    const [atSubdomain] = await txt("_dmarc.sub.example.co.uk");
    expect(atSubdomain).toContain("p=none");

    const [atOrg] = await txt("_dmarc.example.co.uk");
    expect(atOrg).toContain("p=reject");

    // A resolver that used the subdomain's record would apply p=none — no
    // enforcement — while the domain owner asked for quarantine via sp=.
    expect(atSubdomain).not.toBe(atOrg);
  });

  it("never climbs to the public suffix itself", () => {
    // There is deliberately no _dmarc.co.uk in the fixtures, and there must
    // never be a lookup for one.
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

  it("stops CAA climbing at the org domain rather than walking to io", () => {
    // RFC 8659 climbs the name tree, but a policy at github.io would belong to
    // GitHub, not to this customer. The org domain is the floor.
    expect(getRegistrableDomain("pages.user.github.io")).toBe("user.github.io");
    expect(getRegistrableDomain("github.io")).toBeNull();
  });
});
