import { Resend } from "resend";

/**
 * Sending, behind an interface.
 *
 * The interface is not indirection for its own sake. Every other external thing
 * in this repo is tested against the real one — DNS against NSD, the queue
 * against Redis, the database against Postgres — because there is something to
 * learn from the real behaviour. A transactional email provider is the exception:
 * a real send in CI would mail an actual person, and nothing about Resend's
 * response teaches us anything the type signature does not.
 *
 * So `createRecordingMailer` is the one sanctioned fake in this codebase, and it
 * lives here rather than in a spec file so the API's specs share it and nobody is
 * tempted to stub `fetch`.
 */

export interface Message {
  readonly html: string;
  readonly subject: string;
  readonly text: string;
  readonly to: string;
}

export type SendOutcome =
  | { readonly id: string; readonly kind: "sent" }
  /**
   * A send that failed.
   *
   * Returned rather than thrown, because the caller's decision depends on it and
   * a throw would make that decision at the wrong level: a failed OTP send must
   * not fail the signup request — the account is fine, the mail is not, and the
   * honest response is still 202 with a loud log.
   */
  | { readonly error: string; readonly kind: "failed" };

export interface Mailer {
  send: (message: Message) => Promise<SendOutcome>;
}

export interface MailerOptions {
  readonly apiKey: string;
  /**
   * The envelope sender.
   *
   * A subdomain — `notifications.propgate.dev` — never the apex. A blocklisting
   * incident from transactional mail should not reach the domain the product is
   * served from, and separating them is the only way to keep that true.
   */
  readonly from: string;
}

export function createMailer(options: MailerOptions): Mailer {
  const resend = new Resend(options.apiKey);

  return {
    async send(message) {
      try {
        const result = await resend.emails.send({
          from: options.from,
          html: message.html,
          subject: message.subject,
          text: message.text,
          to: message.to,
        });

        if (result.error !== null) {
          return { error: result.error.message, kind: "failed" };
        }

        return { id: result.data?.id ?? "", kind: "sent" };
      } catch (cause) {
        return {
          error: cause instanceof Error ? cause.message : String(cause),
          kind: "failed",
        };
      }
    },
  };
}

export interface RecordingMailer extends Mailer {
  readonly sent: readonly Message[];
}

/**
 * A mailer that keeps what it was asked to send.
 *
 * `failWith` exists so the "the provider is down" path is testable — that branch
 * decides whether a signup request still returns 202, which is the part that
 * matters and the part nobody would otherwise exercise.
 */
export function createRecordingMailer(options?: {
  readonly failWith?: string;
}): RecordingMailer {
  const sent: Message[] = [];

  return {
    async send(message) {
      sent.push(message);

      return await Promise.resolve(
        options?.failWith === undefined
          ? { id: `rec_${sent.length}`, kind: "sent" as const }
          : { error: options.failWith, kind: "failed" as const }
      );
    },
    sent,
  };
}
