import { describe, expect, it } from "vitest";
import { createRecordingMailer } from "./client";
import { otpMessage } from "./otp";

const CODE = "418302";
const WHITESPACE = /\s+/g;

describe("otpMessage", () => {
  it("puts the code in the subject as well as the body", () => {
    const message = otpMessage({
      code: CODE,
      email: "someone@example.com",
      expiresInMinutes: 10,
    });

    expect(message.subject).toContain(CODE);
    expect(message.text).toContain(CODE);
    expect(message.html).toContain(CODE);
  });

  it("tells somebody who did not ask for this that ignoring it is correct", () => {
    const message = otpMessage({
      code: CODE,
      email: "someone@example.com",
      expiresInMinutes: 10,
    });

    expect(message.text).toContain("did not request this");
    expect(message.text).toContain("No account has been created");
    expect(message.html).toContain("did not request this");
  });

  it("does not glue words together where a sentence wraps", () => {
    const message = otpMessage({
      code: CODE,
      email: "someone@example.com",
      expiresInMinutes: 10,
    });

    for (const body of [message.text, message.html]) {
      const rendered = body.replace(WHITESPACE, " ");

      expect(rendered).toContain("typed your address by mistake");
      expect(rendered).toContain("nothing will happen if you ignore");
    }
  });

  it("states the expiry it was given rather than a hardcoded one", () => {
    expect(
      otpMessage({ code: CODE, email: "a@b.com", expiresInMinutes: 15 }).text
    ).toContain("15 minutes");
  });

  it("says the code is single use", () => {
    expect(
      otpMessage({ code: CODE, email: "a@b.com", expiresInMinutes: 10 }).text
    ).toContain("once");
  });
});

describe("createRecordingMailer", () => {
  it("keeps what it was asked to send", async () => {
    const mailer = createRecordingMailer();
    const outcome = await mailer.send(
      otpMessage({ code: CODE, email: "a@b.com", expiresInMinutes: 10 })
    );

    expect(outcome.kind).toBe("sent");
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe("a@b.com");
  });

  it("can fail on demand, so the provider-is-down path is reachable", async () => {
    const mailer = createRecordingMailer({ failWith: "rate limited" });
    const outcome = await mailer.send(
      otpMessage({ code: CODE, email: "a@b.com", expiresInMinutes: 10 })
    );

    expect(outcome).toMatchObject({ error: "rate limited", kind: "failed" });
    expect(mailer.sent).toHaveLength(1);
  });
});
