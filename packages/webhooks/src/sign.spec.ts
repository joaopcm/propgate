import { describe, expect, it } from "vitest";
import {
  generateSecret,
  signPayload,
  TOLERANCE_SECONDS,
  verifyPayload,
} from "./sign";

/**
 * The public contract, pinned.
 *
 * A refactor that changes what gets signed breaks every customer at once and does
 * so invisibly — our side keeps signing happily and only their verification
 * fails. So the first assertion here is a fixed vector: a known secret, id,
 * timestamp and body against a signature computed by hand. If that value ever
 * changes, it is a breaking change and this spec is the thing that says so.
 */

// A real `whsec_` secret, published here on purpose: it signs nothing.
const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
const ID = "msg_2XvKQ9r8GKYqrTwjUPD8ILPZ";
const TIMESTAMP = 1_785_782_400;
const BODY = '{"type":"domain.verified"}';

const NEEDS_A_SECRET = /at least one secret/;

describe("signPayload", () => {
  it("matches a fixed vector, so a change to the signing input is visible", () => {
    const headers = signPayload({
      body: BODY,
      id: ID,
      secrets: [SECRET],
      timestamp: TIMESTAMP,
    });

    // Confirmed with openssl rather than by copying what this code returned,
    // which would make the assertion circular and worthless:
    //
    //   KEYHEX=$(printf %s "${SECRET#whsec_}" | base64 -d | xxd -p -c 256)
    //   printf '%s' "$ID.$TIMESTAMP.$BODY" |
    //     openssl dgst -sha256 -mac HMAC -macopt "hexkey:$KEYHEX" -binary | base64
    //
    // -> EmeNAlVmUMg2BkeheENUNNlyuGqraSQNPs4PG+lsgFY=
    expect(headers["webhook-signature"]).toBe(
      "v1,EmeNAlVmUMg2BkeheENUNNlyuGqraSQNPs4PG+lsgFY="
    );
  });

  it("signs the id and the timestamp, not just the body", () => {
    // Without the timestamp a captured request replays forever; without the id a
    // body signed for one delivery replays as another.
    const base = { body: BODY, secrets: [SECRET] };
    const signed = signPayload({ ...base, id: ID, timestamp: TIMESTAMP });
    const laterTime = signPayload({
      ...base,
      id: ID,
      timestamp: TIMESTAMP + 1,
    });
    const otherId = signPayload({
      ...base,
      id: "msg_other",
      timestamp: TIMESTAMP,
    });

    expect(laterTime["webhook-signature"]).not.toBe(
      signed["webhook-signature"]
    );
    expect(otherId["webhook-signature"]).not.toBe(signed["webhook-signature"]);
  });

  it("strips the whsec_ prefix before keying the HMAC", () => {
    // The prefix is a label for humans. Treating it as key material is the most
    // common way an integration produces signatures that never match while
    // looking correct on both sides.
    const withPrefix = signPayload({
      body: BODY,
      id: ID,
      secrets: [SECRET],
      timestamp: TIMESTAMP,
    });
    const without = signPayload({
      body: BODY,
      id: ID,
      secrets: [SECRET.replace("whsec_", "")],
      timestamp: TIMESTAMP,
    });

    expect(without["webhook-signature"]).toBe(withPrefix["webhook-signature"]);
  });

  it("emits every secret space-separated during a rotation window", () => {
    const rotated = generateSecret();
    const headers = signPayload({
      body: BODY,
      id: ID,
      secrets: [rotated, SECRET],
      timestamp: TIMESTAMP,
    });
    const signatures = headers["webhook-signature"].split(" ");

    expect(signatures).toHaveLength(2);
    // Both independently valid, which is what lets a customer who has rotated and
    // one who has not both keep working.
    expect(
      verifyPayload({
        body: BODY,
        header: headers["webhook-signature"],
        id: ID,
        secret: rotated,
        timestamp: TIMESTAMP,
      })
    ).toBe(true);
    expect(
      verifyPayload({
        body: BODY,
        header: headers["webhook-signature"],
        id: ID,
        secret: SECRET,
        timestamp: TIMESTAMP,
      })
    ).toBe(true);
  });

  it("refuses to sign with no secret at all", () => {
    // An unsigned webhook is worse than none: a receiver cannot tell it from a
    // forgery, and the safe default would be to reject it — silently, forever.
    expect(() =>
      signPayload({ body: BODY, id: ID, secrets: [], timestamp: TIMESTAMP })
    ).toThrow(NEEDS_A_SECRET);
  });
});

describe("verifyPayload", () => {
  it("accepts what signPayload produced", () => {
    const headers = signPayload({
      body: BODY,
      id: ID,
      secrets: [SECRET],
      timestamp: TIMESTAMP,
    });

    expect(
      verifyPayload({
        body: BODY,
        header: headers["webhook-signature"],
        id: ID,
        secret: SECRET,
        timestamp: TIMESTAMP,
      })
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const headers = signPayload({
      body: BODY,
      id: ID,
      secrets: [SECRET],
      timestamp: TIMESTAMP,
    });

    expect(
      verifyPayload({
        body: '{"type":"domain.failed"}',
        header: headers["webhook-signature"],
        id: ID,
        secret: SECRET,
        timestamp: TIMESTAMP,
      })
    ).toBe(false);
  });

  it("rejects a signature from a different secret", () => {
    const headers = signPayload({
      body: BODY,
      id: ID,
      secrets: [generateSecret()],
      timestamp: TIMESTAMP,
    });

    expect(
      verifyPayload({
        body: BODY,
        header: headers["webhook-signature"],
        id: ID,
        secret: SECRET,
        timestamp: TIMESTAMP,
      })
    ).toBe(false);
  });

  it("returns false rather than throwing on a malformed header", () => {
    // timingSafeEqual throws on a length mismatch. Unguarded, a junk header would
    // be a 500 instead of a rejection — which is a denial of service with extra
    // steps.
    for (const header of ["", "v1,", "garbage", "v1,!!!not-base64!!!"]) {
      expect(
        verifyPayload({
          body: BODY,
          header,
          id: ID,
          secret: SECRET,
          timestamp: TIMESTAMP,
        })
      ).toBe(false);
    }
  });
});

describe("generateSecret", () => {
  it("is prefixed and long enough to be worth signing with", () => {
    const secret = generateSecret();

    expect(secret.startsWith("whsec_")).toBe(true);
    expect(
      Buffer.from(secret.replace("whsec_", ""), "base64").length
    ).toBeGreaterThanOrEqual(24);
  });

  it("does not repeat", () => {
    const secrets = new Set(Array.from({ length: 50 }, () => generateSecret()));

    expect(secrets.size).toBe(50);
  });
});

describe("TOLERANCE_SECONDS", () => {
  it("matches the Svix default, so stock verification libraries agree with our docs", () => {
    expect(TOLERANCE_SECONDS).toBe(300);
  });
});
