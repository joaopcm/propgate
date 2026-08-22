import { describe, expect, it } from "vitest";
import {
  generateSecret,
  signPayload,
  TOLERANCE_SECONDS,
  verifyPayload,
} from "./sign";

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

    expect(headers["webhook-signature"]).toBe(
      "v1,EmeNAlVmUMg2BkeheENUNNlyuGqraSQNPs4PG+lsgFY="
    );
  });

  it("signs the id and the timestamp, not just the body", () => {
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
