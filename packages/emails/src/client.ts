import { Resend } from "resend";

export interface Message {
  readonly html: string;
  readonly subject: string;
  readonly text: string;
  readonly to: string;
}

export type SendOutcome =
  | { readonly id: string; readonly kind: "sent" }
  | { readonly error: string; readonly kind: "failed" };

export interface Mailer {
  send: (message: Message) => Promise<SendOutcome>;
}

export interface MailerOptions {
  readonly apiKey: string;
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
