import { createHash, randomInt } from "node:crypto";
import type { Database } from "@propgate/db";
import {
  consumeCode,
  createApiKey,
  findOrCreateAccountForEmail,
  issueCode,
} from "@propgate/db";
import type { Mailer } from "@propgate/emails";
import { otpMessage } from "@propgate/emails";
import { captureException } from "@sentry/node";
import { Hono } from "hono";
import { z } from "zod";
import type { RateLimiter } from "../utils/rate-limit";
import { accepted, error, success } from "../utils/response";
import { firstIssue } from "../utils/validation";

/**
 * Self-serve signup: `POST /v1/signup`, then `POST /v1/signup/confirm`.
 *
 * The only unauthenticated routes that write to the database, which is what makes
 * every guard below load-bearing rather than decorative. Both are deliberately
 * absent from the auth middleware list in `app.ts` — the mailbox is the
 * credential here, and there is no key to present until the flow has finished.
 *
 * Whoever controls the address can mint a key. That is the same security model as
 * every password-reset flow ever shipped, and it is why the OTP guards are the
 * real security boundary rather than a rate limit somebody can shrug at.
 */

/**
 * Six digits, ten minutes.
 *
 * Short enough to read out of a notification without opening the mail, which is
 * the whole reason not to use a long token. The cap on attempts is what makes six
 * digits safe — see `MAX_ATTEMPTS` in `packages/db/src/queries/otp.ts` — so the
 * length is a usability decision and the security lives next door.
 */
const CODE_DIGITS = 6;
const CODE_TTL_MINUTES = 10;

/**
 * The signup limiter, per client address.
 *
 * **A tripwire, and the only thing standing between this endpoint and being a
 * spam relay with our sending reputation attached.** Twenty an hour: a genuine
 * flow costs two to four requests, so this leaves room for several people behind
 * one office NAT while capping outbound mail at twenty messages per address-hour.
 *
 * It covers `confirm` as well as `signup`, which is what bounds online code
 * guessing from one source — the five-attempt cap in `otp_codes` is per address,
 * so without this an attacker could spread guesses across many addresses and
 * never feel it.
 *
 * The client address comes from a header, so this is only as trustworthy as the
 * proxy in front (Caddy, in the deployment this ships with). Without one it is
 * spoofable, which is the same caveat the public checker's limiter carries and
 * the reason neither is described as a security boundary.
 */
export const SIGNUPS_PER_IP_PER_HOUR = 20;
export const SIGNUP_RATE_LIMIT_WINDOW_MS = 3_600_000;

/** 64 for the local part, 255 for the domain, one for the `@`. */
const MAX_EMAIL_LENGTH = 320;

const KEY_NAME = "onboarding";

const signupSchema = z.object({
  email: z.string().min(3).max(MAX_EMAIL_LENGTH),
});

const confirmSchema = z.object({
  code: z.string().length(CODE_DIGITS),
  email: z.string().min(3).max(MAX_EMAIL_LENGTH),
});

/**
 * Deliberately not `z.email()`.
 *
 * The only test of an address that means anything is whether mail to it arrives,
 * and this flow performs exactly that test one step later. A stricter regex here
 * buys nothing and costs the addresses it gets wrong — and RFC 5321 permits far
 * more than any validator in common use accepts. So the shape check is "has an
 * `@` with something either side", and the mailbox decides the rest.
 */
function rejectEmail(email: string): string | null {
  const at = email.indexOf("@");

  if (at < 1 || at === email.length - 1 || email.includes(" ")) {
    return "email must be an address with a local part and a domain";
  }

  return null;
}

/** Lowercased and trimmed, so `A@b.com` and `a@b.com` are one account. */
function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function generateCode(): string {
  // `randomInt` rather than `Math.random`: this is a credential, and a uniform
  // CSPRNG is one import away.
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

/**
 * What goes in `otp_codes.code_hash`.
 *
 * The email is mixed in so one precomputed table cannot cover every address at
 * once. Be honest about the ceiling on that, though: six digits is a millionth of
 * the space a password has, so anybody holding the database can recover a live
 * code in milliseconds regardless of how it was hashed. The hash keeps codes out
 * of logs, backups and casual sight — the ten-minute expiry and the five-attempt
 * cap are what actually bound an attacker, and they would still be doing that job
 * if this were plaintext.
 */
function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${email}:${code}`).digest("hex");
}

/** The client address, for rate limiting only. */
function clientKey(forwarded: string | undefined): string {
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export function createSignupRoute(options: {
  db: Database;
  limiter: RateLimiter;
  mailer: Mailer;
}) {
  const route = new Hono();

  route.post("/", async (c) => {
    const verdict = options.limiter.take(
      clientKey(c.req.header("x-forwarded-for"))
    );

    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));

      return error(
        c,
        429,
        `too many signup requests; try again in ${verdict.retryAfterSeconds}s`
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = signupSchema.safeParse(body);

    if (!parsed.success) {
      return error(c, 400, firstIssue(parsed.error));
    }

    const email = normaliseEmail(parsed.data.email);
    const rejection = rejectEmail(email);

    if (rejection !== null) {
      return error(c, 400, rejection);
    }

    const now = new Date();
    const code = generateCode();
    const outcome = await issueCode(
      options.db,
      {
        codeHash: hashCode(email, code),
        email,
        expiresAt: new Date(now.getTime() + CODE_TTL_MINUTES * 60_000),
      },
      now
    );

    if (outcome.kind === "issued") {
      const sent = await options.mailer.send(
        otpMessage({ code, email, expiresInMinutes: CODE_TTL_MINUTES })
      );

      if (sent.kind === "failed") {
        // Loudly, and still 202. The store is consistent and the account is
        // fine; the mail is not, and that is ours to fix rather than the
        // caller's. Failing the request would tell them to retry, which cannot
        // help — the cooldown means the retry sends nothing.
        captureException(new Error("signup mail failed"), {
          extra: { reason: sent.error },
        });
      }
    }

    /**
     * The same 202 and the same body either way.
     *
     * Whether the address was already known, whether a code was just sent, and
     * whether it was inside the cooldown are all invisible here, on purpose.
     * Anything else is an account-enumeration oracle: a signup endpoint that
     * says "already registered" tells whoever holds a leaked address list which
     * of those addresses use us, and that list is worth money to them.
     */
    return accepted(c, { object: "signup", status: "pending" });
  });

  route.post("/confirm", async (c) => {
    const verdict = options.limiter.take(
      clientKey(c.req.header("x-forwarded-for"))
    );

    if (!verdict.allowed) {
      c.header("Retry-After", String(verdict.retryAfterSeconds));

      return error(
        c,
        429,
        `too many signup requests; try again in ${verdict.retryAfterSeconds}s`
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = confirmSchema.safeParse(body);

    if (!parsed.success) {
      return error(c, 400, firstIssue(parsed.error));
    }

    const email = normaliseEmail(parsed.data.email);
    const outcome = await consumeCode(options.db, {
      codeHash: hashCode(email, parsed.data.code),
      email,
    });

    if (outcome !== "consumed") {
      /**
       * One status and one message for all four ways this fails.
       *
       * `consumeCode` distinguishes wrong from expired from exhausted from never
       * requested, and every one of those distinctions is an oracle if it reaches
       * the client: "expired" confirms the address signed up here, "exhausted"
       * confirms somebody is already guessing at it. They exist for the log.
       *
       * 409 rather than 400 because the common case by far is a code that was
       * already spent — a double-submitted form, or somebody clicking through
       * twice — and that is a conflict with state rather than a malformed
       * request. The body says what to do next, which is the part that helps.
       */
      return error(
        c,
        409,
        "that code is not valid or has already been used; request a new one with POST /v1/signup"
      );
    }

    const account = await findOrCreateAccountForEmail(options.db, { email });
    const key = await createApiKey(options.db, {
      // The one place attribution is unambiguous: this member just proved control
      // of the mailbox, in this request.
      createdByMemberId: account.memberId,
      name: KEY_NAME,
      tenantId: account.tenantId,
    });

    // The only time this key is ever readable. `api_keys` stores a hash, so
    // there is no endpoint that could return it again later even if we wanted
    // one — which is what the CLI's "stored, and will not be shown again"
    // wording is telling the truth about.
    return success(c, {
      apiKey: key.key,
      created: account.created,
      object: "account",
      tenantId: account.tenantId,
    });
  });

  return route;
}
