import { Resend } from "resend";

export interface Contact {
  readonly email: string;
}

export type AddContactOutcome =
  | { readonly id: string; readonly kind: "added" }
  | { readonly error: string; readonly kind: "failed" };

export interface ContactList {
  add: (contact: Contact) => Promise<AddContactOutcome>;
}

export interface ContactListOptions {
  readonly apiKey: string;
  readonly segmentId: string;
}

export const CONTACT_ADD_TIMEOUT_MS = 5000;

type Bounded<T> =
  | { readonly kind: "settled"; readonly value: T }
  | { readonly kind: "threw"; readonly cause: unknown }
  | { readonly kind: "timedout" };

export function bounded<T>(work: Promise<T>, ms: number): Promise<Bounded<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const settled = work.then(
    (value): Bounded<T> => ({ kind: "settled", value }),
    (cause): Bounded<T> => ({ cause, kind: "threw" })
  );

  return Promise.race([
    settled,
    new Promise<Bounded<T>>((resolve) => {
      timer = setTimeout(() => resolve({ kind: "timedout" }), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function reason(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function createContactList(options: ContactListOptions): ContactList {
  const resend = new Resend(options.apiKey);

  return {
    async add(contact) {
      const outcome = await bounded(
        resend.contacts.create({
          email: contact.email,
          segments: [{ id: options.segmentId }],
          unsubscribed: false,
        }),
        CONTACT_ADD_TIMEOUT_MS
      );

      if (outcome.kind === "timedout") {
        return {
          error: `resend did not answer within ${CONTACT_ADD_TIMEOUT_MS}ms; ${contact.email} was not added to segment ${options.segmentId}`,
          kind: "failed",
        };
      }

      if (outcome.kind === "threw") {
        return { error: reason(outcome.cause), kind: "failed" };
      }

      const result = outcome.value;

      if (result.error !== null) {
        return { error: result.error.message, kind: "failed" };
      }

      return { id: result.data?.id ?? "", kind: "added" };
    },
  };
}

export interface RecordingContactList extends ContactList {
  readonly added: readonly Contact[];
}

export function createRecordingContactList(options?: {
  readonly failWith?: string;
}): RecordingContactList {
  const added: Contact[] = [];

  return {
    async add(contact) {
      added.push(contact);

      return await Promise.resolve(
        options?.failWith === undefined
          ? { id: `rec_${added.length}`, kind: "added" as const }
          : { error: options.failWith, kind: "failed" as const }
      );
    },
    added,
  };
}
