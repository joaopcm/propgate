import { createHash, randomInt } from "node:crypto";
import type { Database } from "@propgate/db";
import {
  consumeCode,
  createApiKey,
  findOrCreateAccountForEmail,
  issueCode,
} from "@propgate/db";
import type { ContactList, Mailer } from "@propgate/emails";
import { otpMessage } from "@propgate/emails";
import { captureException } from "@sentry/node";
import { Hono } from "hono";
import { z } from "zod";
import type { RateLimiter } from "../utils/rate-limit";
import { accepted, error, success } from "../utils/response";
import { firstIssue } from "../utils/validation";

const CODE_DIGITS = 6;
const CODE_TTL_MINUTES = 10;

export const SIGNUPS_PER_IP_PER_HOUR = 20;
export const SIGNUP_RATE_LIMIT_WINDOW_MS = 3_600_000;

const MAX_EMAIL_LENGTH = 320;

const KEY_NAME = "onboarding";

const signupSchema = z.object({
  email: z.string().min(3).max(MAX_EMAIL_LENGTH),
});

const confirmSchema = z.object({
  code: z.string().length(CODE_DIGITS),
  email: z.string().min(3).max(MAX_EMAIL_LENGTH),
});

function rejectEmail(email: string): string | null {
  const at = email.indexOf("@");

  if (at < 1 || at === email.length - 1 || email.includes(" ")) {
    return "email must be an address with a local part and a domain";
  }

  return null;
}

function normaliseEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_DIGITS)).padStart(CODE_DIGITS, "0");
}

function hashCode(email: string, code: string): string {
  return createHash("sha256").update(`${email}:${code}`).digest("hex");
}

function clientKey(forwarded: string | undefined): string {
  return forwarded?.split(",")[0]?.trim() || "unknown";
}

export function createSignupRoute(options: {
  contacts?: ContactList;
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
      return error(c, 422, firstIssue(parsed.error));
    }

    const email = normaliseEmail(parsed.data.email);
    const rejection = rejectEmail(email);

    if (rejection !== null) {
      return error(c, 422, rejection);
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
        captureException(new Error("signup mail failed"), {
          extra: { reason: sent.error },
        });
      }
    }

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
      return error(c, 422, firstIssue(parsed.error));
    }

    const email = normaliseEmail(parsed.data.email);
    const outcome = await consumeCode(options.db, {
      codeHash: hashCode(email, parsed.data.code),
      email,
    });

    if (outcome !== "consumed") {
      return error(
        c,
        409,
        "that code is not valid or has already been used; request a new one with POST /v1/signup"
      );
    }

    const account = await findOrCreateAccountForEmail(options.db, { email });

    if (options.contacts !== undefined && account.created) {
      const added = await options.contacts.add({ email });

      if (added.kind === "failed") {
        captureException(new Error("signup contact add failed"), {
          extra: { reason: added.error },
        });
      }
    }

    const key = await createApiKey(options.db, {
      createdByMemberId: account.memberId,
      name: KEY_NAME,
      tenantId: account.tenantId,
    });

    return success(c, {
      apiKey: key.key,
      created: account.created,
      object: "account",
      tenantId: account.tenantId,
    });
  });

  return route;
}
