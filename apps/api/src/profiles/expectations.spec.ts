import type { ProfileDefinition } from "@propgate/db";
import { describe, expect, it } from "vitest";
import {
  rejectExpectations,
  rejectUnsatisfiedExpectations,
} from "./expectations";

/**
 * The write-time half of the shape/value split.
 *
 * `compileProfile` is what makes a missing value safe; this is what makes it
 * visible, at the moment the caller can still fix it. Both are needed: without
 * the compile a gap passes silently, and without this a gap is only discovered by
 * a sweep hours later.
 */

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
    // Both spellings reach this from real callers, and neither is an error on
    // its own — a profile asking for nothing needs nothing.
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
    /**
     * The single most important rejection here.
     *
     * Ignoring a mistyped key is indistinguishable from honouring it: the caller
     * gets a domain that looks configured and is compared against nothing. This
     * is also why the check cannot be a zod schema — zod strips unknown keys by
     * default, so the typo would never reach any code that could object.
     */
    expect(
      rejectExpectations("sending", DEFERS_KEY, {
        dkm: { expectedPublicKey: "MIIBIjANB" },
      })
    ).toContain('expectations name "dkm"');
  });

  it("refuses a field the requirement did not defer", () => {
    // `spf` carries a literal include here. Accepting an override would let the
    // domain choose what it is checked against.
    expect(
      rejectExpectations("sending", DEFERS_KEY, {
        dkim: { expectedPublicKey: "MIIBIjANB" },
        spf: { include: "evil.example" },
      })
    ).toContain('does not require "include" per domain');
  });

  it("reports the unknown key before complaining about what is missing", () => {
    // A caller who mistyped the key has supplied the value; being told it is
    // missing would send them looking for the wrong mistake.
    expect(
      rejectExpectations("sending", DEFERS_KEY, {
        dkm: { expectedPublicKey: "MIIBIjANB" },
      })
    ).not.toContain("was not supplied");
  });
});

describe("values carried forward rather than submitted", () => {
  /**
   * A domain re-pointed at another profile keeps what its previous one asked for.
   *
   * Those keys are legitimately unknown to the new definition — stale, not
   * mistyped — so the strict check would make every re-point a 422. The strictness
   * exists to catch a typo in a request, and there is no request here.
   */
  it("accepts a stale key the new profile knows nothing about", () => {
    expect(
      rejectUnsatisfiedExpectations("web", DEFERS_NOTHING, {
        dkim: { expectedPublicKey: "left over from the old profile" },
      })
    ).toBeNull();
  });

  it("still refuses values that do not satisfy the new profile", () => {
    // Leniency about extra keys, never about missing ones. A re-point the stored
    // values cannot satisfy has to fail while the domain is still untouched.
    expect(
      rejectUnsatisfiedExpectations("sending", DEFERS_KEY, {
        somethingElse: { include: "x" },
      })
    ).toContain("expectations.dkim.expectedPublicKey");
  });

  it("is exactly the strict check minus the extra-key rules", () => {
    // Both must agree wherever the strict one is about a missing value, or a
    // re-point and a registration would disagree about the same domain.
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
    /**
     * The write-time half of the fix. `rejectDefinition` cannot see this: at
     * profile-write time neither label has a value yet, so uniqueness is not
     * decidable. Here it is, and refusing is what stops the domain from ever
     * reaching attribution — where two outcomes share a label, only one can be
     * taken, and the requirement that loses reads its neighbour's verdict.
     */
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
    // A label is optional for ownership, so two requirements deferring only the
    // token both land at the apex. The message has to say where.
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
    // Two requirements with nothing behind them resolve to the same empty
    // discriminator. Reporting that as a collision names the wrong fault and
    // sends the caller to change a label instead of supplying a token.
    expect(
      rejectExpectations("own", TWO_TOKENS, { a: { label: "_pg" } })
    ).toContain("which was not supplied");
  });

  it("applies to values carried forward, not only to submitted ones", () => {
    // A domain re-pointed at another profile keeps its old values. If those
    // collide under the new definition, the domain is unverifiable either way.
    expect(
      rejectUnsatisfiedExpectations("own", TWO_TOKENS, {
        a: { label: "_pg", token: "T1" },
        b: { label: "_pg", token: "T2" },
      })
    ).toContain("neither result could be told from the other");
  });
});
