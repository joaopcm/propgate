import type { Message } from "./client";

/**
 * The one message this product sends.
 *
 * Plain text and minimal HTML, no renderer. A single transactional email does not
 * justify a template engine and a build step; revisit if a second one appears.
 */

export interface OtpMessageInput {
  readonly code: string;
  readonly email: string;
  readonly expiresInMinutes: number;
}

export function otpMessage(input: OtpMessageInput): Message {
  /**
   * The code is in the subject as well as the body.
   *
   * Mail clients preview subjects, so a code readable from the notification is
   * one the recipient never has to open the message for. It also survives a
   * client that refuses to render our HTML.
   */
  const subject = `${input.code} is your propgate confirmation code`;

  /**
   * The "you can ignore this" line is not politeness.
   *
   * Signup is open, so anybody can type a stranger's address into it. Somebody
   * who did not ask for this needs to know in one sentence that no account was
   * created in their name and that doing nothing is the correct response —
   * otherwise the honest reaction is to assume they have been compromised.
   */
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
    /**
     * Joined on a newline, not an empty string.
     *
     * These entries are source lines rather than complete elements, so a sentence
     * wrapped across two of them was being glued together: "typedyour address",
     * "happenif you ignore". HTML collapses whitespace, so a newline renders as
     * the space the prose needs while leaving the markup identical — which also
     * means the next person who wraps a line here cannot reintroduce it.
     */
  ].join("\n");

  return { html, subject, text, to: input.email };
}
