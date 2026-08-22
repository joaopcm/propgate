import type { ProfileDefinition } from "@propgate/db";
import { describe, expect, it } from "vitest";
import {
  rejectExpectations,
  rejectUnsatisfiedExpectations,
} from "./expectations";

const DEFERS_KEY: ProfileDefinition = {
  requirements: [
    { check: "spf", include: "_spf.partner.example", key: "spf" },
    {
      check: "dkim",
      key: "dkim",
      requiredPerDomain: ["expectedPublicKey"],
      selector: "pg1",
    },
  ],
};

const DEFERS_NOTHING: ProfileDefinition = {
  requirements: [{ check: "dmarc", key: "dmarc" }],
};

describe("a profile that defers nothing", () => {
  it("accepts a domain that supplies nothing", () => {
    expect(rejectExpectations("web", DEFERS_NOTHING, null)).toBeNull();
  });

  it("accepts an empty object as equivalent to nothing", () => {
    expect(rejectExpectations("web", DEFERS_NOTHING, {})).toBeNull();
  });

  it("refuses a value for a check kind that has no per-domain fields", () => {
    expect(
      rejectExpectations("web", DEFERS_NOTHING, { dmarc: { include: "x" } })
    ).toContain("takes no per-domain fields");
  });
});

describe("a profile that requires a value per domain", () => {
  it("accepts a domain that supplies it", () => {
    expect(
      rejectExpectations("sending", DEFERS_KEY, {
        dkim: { expectedPublicKey: "MIIBIjANB" },
      })
    ).toBeNull();
  });

  it("names the exact path when the value is absent", () => {
    expect(rejectExpectations("sending", DEFERS_KEY, null)).toBe(
      'profile "sending" requires expectations.dkim.expectedPublicKey, which was not supplied'
    );
  });

  it("treats a blank value as not supplied", () => {
    expect(
      rejectExpectations("sending", DEFERS_KEY, {
        dkim: { expectedPublicKey: "  " },
      })
    ).toContain("was not supplied");
  });

  it("refuses a requirement key that is not in the profile", () => {
    expect(
      rejectExpectations("sending", DEFERS_KEY, {
        dkm: { expectedPublicKey: "MIIBIjANB" },
      })
    ).toContain('expectations name "dkm"');
  });

  it("refuses a field the requirement did not defer", () => {
    expect(
      rejectExpectations("sending", DEFERS_KEY, {
        dkim: { expectedPublicKey: "MIIBIjANB" },
        spf: { include: "evil.example" },
      })
    ).toContain('does not require "include" per domain');
  });

  it("reports the unknown key before complaining about what is missing", () => {
    expect(
      rejectExpectations("sending", DEFERS_KEY, {
        dkm: { expectedPublicKey: "MIIBIjANB" },
      })
    ).not.toContain("was not supplied");
  });
});

describe("values carried forward rather than submitted", () => {
  it("accepts a stale key the new profile knows nothing about", () => {
    expect(
      rejectUnsatisfiedExpectations("web", DEFERS_NOTHING, {
        dkim: { expectedPublicKey: "left over from the old profile" },
      })
    ).toBeNull();
  });

  it("still refuses values that do not satisfy the new profile", () => {
    expect(
      rejectUnsatisfiedExpectations("sending", DEFERS_KEY, {
        somethingElse: { include: "x" },
      })
    ).toContain("expectations.dkim.expectedPublicKey");
  });

  it("is exactly the strict check minus the extra-key rules", () => {
    const values = { dkim: { expectedPublicKey: "MIIBIjANB" } };

    expect(rejectUnsatisfiedExpectations("sending", DEFERS_KEY, values)).toBe(
      rejectExpectations("sending", DEFERS_KEY, values)
    );
    expect(rejectUnsatisfiedExpectations("sending", DEFERS_KEY, null)).toBe(
      rejectExpectations("sending", DEFERS_KEY, null)
    );
  });
});

describe("values that would collapse two requirements onto one name", () => {
  const TWO_TOKENS: ProfileDefinition = {
    requirements: [
      { check: "ownership", key: "a", requiredPerDomain: ["label", "token"] },
      { check: "ownership", key: "b", requiredPerDomain: ["label", "token"] },
    ],
  };

  it("refuses a domain supplying one label for both", () => {
    expect(
      rejectExpectations("own", TWO_TOKENS, {
        a: { label: "_pg", token: "T1" },
        b: { label: "_pg", token: "T2" },
      })
    ).toContain("neither result could be told from the other");
  });

  it("accepts the same pair at different labels", () => {
    expect(
      rejectExpectations("own", TWO_TOKENS, {
        a: { label: "_pg-one", token: "T1" },
        b: { label: "_pg-two", token: "T2" },
      })
    ).toBeNull();
  });

  it("names the apex rather than an empty string", () => {
    expect(
      rejectExpectations(
        "own",
        {
          requirements: [
            { check: "ownership", key: "a", requiredPerDomain: ["token"] },
            { check: "ownership", key: "b", requiredPerDomain: ["token"] },
          ],
        },
        { a: { token: "T1" }, b: { token: "T2" } }
      )
    ).toContain("the apex");
  });

  it("reports a missing value as missing rather than as a collision", () => {
    expect(
      rejectExpectations("own", TWO_TOKENS, { a: { label: "_pg" } })
    ).toContain("which was not supplied");
  });

  it("applies to values carried forward, not only to submitted ones", () => {
    expect(
      rejectUnsatisfiedExpectations("own", TWO_TOKENS, {
        a: { label: "_pg", token: "T1" },
        b: { label: "_pg", token: "T2" },
      })
    ).toContain("neither result could be told from the other");
  });
});
