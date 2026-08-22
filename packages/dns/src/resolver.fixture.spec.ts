import {
  DNSSEC_BOGUS_ZONE,
  DNSSEC_CONTROL_ZONE,
  fixtureResolver,
} from "@propgate/dns-fixtures";
import { describe, expect, it } from "vitest";

describe("fixture tier — DNSSEC differential", () => {
  it("SERVFAILs a bogus zone through the validating resolver", async () => {
    const resolver = fixtureResolver("resolver", 2000);

    await expect(resolver.resolveTxt(DNSSEC_BOGUS_ZONE)).rejects.toThrow();
  });

  it("resolves the same bogus zone through the non-validating resolver", async () => {
    const resolver = fixtureResolver("permissive", 2000);

    const records = await resolver.resolveTxt(DNSSEC_BOGUS_ZONE);

    expect(records.flat().join("")).toContain("non-validating");
  });

  it("resolves the correctly-signed control zone through both tiers", async () => {
    const validating = await fixtureResolver("resolver", 2000).resolveSoa(
      DNSSEC_CONTROL_ZONE
    );
    const permissive = await fixtureResolver("permissive", 2000).resolveSoa(
      DNSSEC_CONTROL_ZONE
    );

    expect(validating.nsname).toBe("ns1.test");
    expect(permissive.nsname).toBe("ns1.test");
  });
});

describe("fixture tier — authoritative servers", () => {
  it("serves the doubled name and NXDOMAINs the correct one", async () => {
    const auth = fixtureResolver("auth");

    const doubled = await auth.resolveTxt(
      "selector1._domainkey.appended.test.appended.test"
    );
    expect(doubled.flat().join("")).toContain("v=DKIM1");

    await expect(
      auth.resolveTxt("selector1._domainkey.appended.test")
    ).rejects.toThrow();
  });

  it("synthesises an answer for any label in the wildcard zone", async () => {
    const auth = fixtureResolver("auth");

    const records = await auth.resolveTxt(
      "never-configured-by-anyone.wildcard.test"
    );

    expect(records.flat().join("")).toContain("do-not-trust");
  });

  it("REFUSES a lame delegation instead of timing out", async () => {
    const decoy = fixtureResolver("decoy");

    await expect(decoy.resolve4("lame.test")).rejects.toThrow();
    await expect(decoy.resolveSoa("decoy.test")).resolves.toMatchObject({
      nsname: "ns-decoy.test",
    });
  });

  it("disagrees with dns-auth from the divergent vantage point", async () => {
    const divergent = await fixtureResolver("divergent").resolveTxt(
      "_propgate-verify.divergent.test"
    );

    expect(divergent.flat().join("")).toContain("STALE-VALUE");
  });
});
