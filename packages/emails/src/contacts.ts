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

/**
 * How long one add may take before it is called failed.
 *
 * **Unmeasured** — a tripwire, not a tuned number. The receipt it waits on is the
 * observed p99 of `POST /contacts`, which nothing here has yet measured; five
 * seconds is far past anything a single-contact write should need, so a healthy
 * call never feels it exists.
 *
 * It exists because the SDK has no timeout of its own and exposes no
 * `AbortSignal`, and this call sits inline in `POST /v1/signup/confirm` **after
 * the code has been spent**. Unbounded, a connection that Resend accepts and then
 * stalls on holds that request open past the point the code is dead: the caller
 * never reaches `createApiKey`, and the key it returns is readable exactly once.
 * A hung mailing list would cost somebody their account, which no mailing list
 * should ever be able to do.
 */
export const CONTACT_ADD_TIMEOUT_MS = 5000;

type Bounded<T> =
  | { readonly kind: "settled"; readonly value: T }
  | { readonly kind: "threw"; readonly cause: unknown }
  | { readonly kind: "timedout" };

/**
 * `work`, or a verdict that it took too long. Exported for `contacts.spec.ts` and
 * deliberately not from the package barrel.
 *
 * Two details are load-bearing and neither is obvious:
 *
 * The rejection is folded into a value rather than left to propagate. Race the raw
 * promise instead and a rejection that arrives first comes back out of here as a
 * throw — which, at the callsite, is thrown from a line that runs after the OTP
 * has been consumed, so a Resend connection reset becomes a 500 on a confirmation
 * whose code is already dead. Every way this can go wrong has to arrive as
 * `kind: "failed"`, and folding is what makes that true by construction rather
 * than by remembering a `try`.
 *
 * A rejection arriving *late*, after the timeout won, needs no such care:
 * `Promise.race` subscribes to every entry, so the loser is already handled and
 * nothing leaks. Worth knowing before "fixing" it.
 *
 * And the timer is cleared on the way out. A pending `setTimeout` holds the event
 * loop open, which in a long-lived server is invisible and in a test run is a
 * suite that will not exit.
 *
 * What it does not do is cancel anything: `PostOptions` carries no signal, so the
 * request is abandoned rather than aborted. It settles later and its answer is
 * dropped on the floor, which is acceptable for a write whose only effect is a
 * row we wanted anyway.
 */
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
        }),
        CONTACT_ADD_TIMEOUT_MS
      );

      if (outcome.kind === "timedout") {
        // Names the budget and the ask, because the reader is an operator staring
        // at a Sentry issue with no other clue about which call stalled.
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
