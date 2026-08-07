import { Resend } from "resend";

/**
 * The marketing list, behind the same kind of interface as `Mailer`.
 *
 * Separate from `client.ts` because the two have nothing to do with each other
 * beyond sharing a vendor: one is transactional mail the signup flow cannot work
 * without, the other is a list somebody sends product announcements to. Wiring
 * them together would mean an outage in the second could plausibly be made to
 * break the first, and there is no reason to accept that.
 *
 * `createRecordingContactList` is a fake for the same reason `createRecordingMailer`
 * is — see the note at the top of `client.ts`. A real call in CI would write a
 * row into the production segment, and Resend's response teaches us nothing the
 * type signature does not.
 */

export interface Contact {
  readonly email: string;
}

export type AddContactOutcome =
  | { readonly id: string; readonly kind: "added" }
  /**
   * Returned rather than thrown, for the same reason a failed send is: the
   * caller's decision depends on it, and the only correct decision at the
   * signup-confirm callsite is to log loudly and hand over the key anyway.
   * Nobody's account should fail to open because a mailing list was down.
   */
  | { readonly error: string; readonly kind: "failed" };

export interface ContactList {
  add: (contact: Contact) => Promise<AddContactOutcome>;
}

export interface ContactListOptions {
  readonly apiKey: string;
  /**
   * The Resend segment the contact is added to.
   *
   * Configured rather than hardcoded because it names a resource inside one
   * specific Resend account. A self-hosted box with its own API key would get a
   * failed call per signup from a literal here, and the failure would be a
   * mystery to whoever is reading their logs.
   */
  readonly segmentId: string;
}

export function createContactList(options: ContactListOptions): ContactList {
  const resend = new Resend(options.apiKey);

  return {
    async add(contact) {
      try {
        const result = await resend.contacts.create({
          email: contact.email,
          segments: [{ id: options.segmentId }],
          /**
           * Subscribed, which is the entire point of adding them.
           *
           * Only ever sent for an address that has just proved it controls the
           * mailbox, and only the first time — see the callsite in
           * `apps/api/src/routes/signup.ts`. Both halves of that matter: the
           * proof is what makes this consent rather than a scraped list, and
           * "only the first time" is what stops a later confirmation from
           * quietly re-subscribing somebody who has since unsubscribed.
           */
          unsubscribed: false,
        });

        if (result.error !== null) {
          return { error: result.error.message, kind: "failed" };
        }

        return { id: result.data?.id ?? "", kind: "added" };
      } catch (cause) {
        return {
          error: cause instanceof Error ? cause.message : String(cause),
          kind: "failed",
        };
      }
    },
  };
}

export interface RecordingContactList extends ContactList {
  readonly added: readonly Contact[];
}

/**
 * `failWith` exists so the "the list is down" path is testable — that branch
 * decides whether a confirmation still returns a key, which is the part that
 * matters and the part nobody would otherwise exercise.
 */
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
