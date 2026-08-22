import type { Message } from "./client";

export interface OtpMessageInput {
  readonly code: string;
  readonly email: string;
  readonly expiresInMinutes: number;
}

export function otpMessage(input: OtpMessageInput): Message {
  const subject = `${input.code} is your propgate confirmation code`;

  const text = [
    `Your propgate confirmation code is ${input.code}.`,
    "",
    `It expires in ${input.expiresInMinutes} minutes and can only be used once.`,
    "",
    "If you did not request this, somebody may have typed your address by",
    "mistake. No account has been created and nothing will happen if you ignore",
    "this message.",
  ].join("\n");

  const html = [
    '<div style="font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.6">',
    "<p>Your propgate confirmation code is</p>",
    `<p style="font:600 28px/1 ui-monospace,monospace;letter-spacing:.15em">${input.code}</p>`,
    `<p>It expires in ${input.expiresInMinutes} minutes and can only be used once.</p>`,
    '<p style="color:#666">If you did not request this, somebody may have typed',
    "your address by mistake. No account has been created and nothing will happen",
    "if you ignore this message.</p>",
    "</div>",
  ].join("\n");

  return { html, subject, text, to: input.email };
}
