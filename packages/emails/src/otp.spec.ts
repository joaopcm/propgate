import { describe, expect, it } from "vitest";
import { createRecordingMailer } from "./client";
import { otpMessage } from "./otp";

const CODE = "418302";

describe("otpMessage", () => {
  it("puts the code in the subject as well as the body", () => {
    // Mail clients preview subjects, so a code readable from the notification is
    // one the recipient never has to open the message for.
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
    // Signup is open, so anybody can type a stranger's address in. Without this
    // the honest reaction to an unexpected code is to assume compromise.
    const message = otpMessage({
      code: CODE,
      email: "someone@example.com",
      expiresInMinutes: 10,
    });

    expect(message.text).toContain("did not request this");
    expect(message.text).toContain("No account has been created");
    expect(message.html).toContain("did not request this");
  });

  it("states the expiry it was given rather than a hardcoded one", () => {
    // The TTL lives in one place. A message claiming ten minutes while the row
    // expires in five is worse than saying nothing.
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
    // That branch decides whether signup still returns 202. Nobody would
    // exercise it otherwise.
    const mailer = createRecordingMailer({ failWith: "rate limited" });
    const outcome = await mailer.send(
      otpMessage({ code: CODE, email: "a@b.com", expiresInMinutes: 10 })
    );

    expect(outcome).toMatchObject({ error: "rate limited", kind: "failed" });
    // Recorded even though it failed: what we attempted to send is part of the
    // story when somebody says they never got a code.
    expect(mailer.sent).toHaveLength(1);
  });
});
