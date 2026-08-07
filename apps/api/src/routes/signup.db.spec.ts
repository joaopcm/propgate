import type { Database } from "@propgate/db";
import { createDb, tenantMembers, tenants, truncateAll } from "@propgate/db";
import type { RecordingContactList, RecordingMailer } from "@propgate/emails";
import {
  createRecordingContactList,
  createRecordingMailer,
} from "@propgate/emails";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";

/**
 * Self-serve signup, against a real Postgres.
 *
 * The mailer is the one fake in here — see `packages/emails/src/client.ts` for
 * why — and it is also how the code gets read, since nothing else in the system
 * can: `otp_codes` stores a hash. That is not a testing inconvenience, it is the
 * property being relied on, and a spec that could read the code out of the
 * database would mean the database could too.
 */

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

const EMAIL = "someone@example.com";

/** The code, as it appears in the mail. */
const SIX_DIGITS = /\b(\d{6})\b/;
const AN_API_KEY = /^pg_/;

function appWith(recorder: RecordingMailer, list?: RecordingContactList) {
  return createApp({
    ...(list === undefined ? {} : { contacts: list }),
    db,
    mailer: recorder,
    resolver: { address: "127.0.0.1", port: 53 },
  });
}

let mailer: RecordingMailer;
let contacts: RecordingContactList;
let app: ReturnType<typeof appWith>;

beforeEach(async () => {
  await truncateAll(db);
  mailer = createRecordingMailer();
  contacts = createRecordingContactList();
  app = appWith(mailer, contacts);
});

afterAll(async () => {
  await db.$client.end();
});

function post(path: string, body: unknown, ip = "203.0.113.1", target = app) {
  return target.request(path, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
      // Distinct per test where it matters: the limiter is per address, and
      // sharing one would make an unrelated test's traffic another's 429.
      "x-forwarded-for": ip,
    },
    method: "POST",
  });
}

/** The code, out of the only place it exists in the clear. */
function codeFrom(sent: RecordingMailer["sent"]): string {
  const last = sent.at(-1);
  const found = SIX_DIGITS.exec(last?.text ?? "");

  if (found?.[1] === undefined) {
    throw new Error(`no six-digit code in: ${last?.text ?? "(nothing sent)"}`);
  }

  return found[1];
}

async function signUp(email = EMAIL, ip?: string): Promise<string> {
  const response = await post("/v1/signup", { email }, ip);

  // Thrown rather than asserted: this is setup, and a failure here means the
  // test never got as far as the thing it was written to check.
  if (response.status !== 202) {
    throw new Error(`signup answered ${response.status}, expected 202`);
  }

  return codeFrom(mailer.sent);
}

describe("POST /v1/signup", () => {
  it("sends a code and accepts", async () => {
    const response = await post("/v1/signup", { email: EMAIL });

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({
      data: { object: "signup", status: "pending" },
      error: null,
      meta: null,
    });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(EMAIL);
  });

  it("answers identically for an address that already has an account", async () => {
    const code = await signUp();
    await post("/v1/signup/confirm", { code, email: EMAIL });

    const known = await post("/v1/signup", { email: EMAIL }, "203.0.113.2");
    const unknown = await post(
      "/v1/signup",
      { email: "nobody@example.com" },
      "203.0.113.3"
    );

    // Byte-identical bodies and statuses. Anything that differs here is an
    // account-enumeration oracle, which is the single most likely thing to
    // regress in this route because every other API convention pushes the other
    // way.
    expect(known.status).toBe(unknown.status);
    await expect(known.json()).resolves.toEqual(await unknown.json());
  });

  it("lowercases the address, so one mailbox is one account", async () => {
    const code = await signUp("Someone@Example.COM");

    expect(mailer.sent[0]?.to).toBe(EMAIL);

    // Confirming with the other casing must land on the same live code.
    const response = await post("/v1/signup/confirm", { code, email: EMAIL });

    expect(response.status).toBe(200);
  });

  it("sends nothing inside the cooldown, and still accepts", async () => {
    await signUp();
    const again = await post("/v1/signup", { email: EMAIL });

    expect(again.status).toBe(202);
    // One mail, not two: the partial unique index on `otp_codes` is what makes a
    // double-submitted form send once.
    expect(mailer.sent).toHaveLength(1);
  });

  it("replaces the live code rather than adding one", async () => {
    // The cooldown is enforced in SQL against `sent_at`, so backdating the row
    // is what "a minute later" looks like without a sleep.
    const first = await signUp();

    // Through the underlying client rather than drizzle: `apps/api` has no
    // direct dependency on `drizzle-orm` and should not grow one for a test.
    await db.$client`update otp_codes set sent_at = now() - interval '2 minutes'`;

    const second = await signUp();

    expect(second).not.toBe(first);

    // The old code is dead, not merely superseded.
    const stale = await post("/v1/signup/confirm", {
      code: first,
      email: EMAIL,
    });

    expect(stale.status).toBe(409);
  });

  it("accepts even when the provider fails, and says nothing about it", async () => {
    const failing = createRecordingMailer({ failWith: "provider down" });
    const response = await appWith(failing).request("/v1/signup", {
      body: JSON.stringify({ email: EMAIL }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    // The account is fine and the caller cannot fix the provider. Telling them
    // to retry would be a lie: the cooldown means the retry sends nothing.
    expect(response.status).toBe(202);
  });

  it("rejects something that is not an address", async () => {
    const response = await post("/v1/signup", { email: "not-an-address" });

    expect(response.status).toBe(422);
    expect(mailer.sent).toHaveLength(0);
  });

  it("stops a request storm from one address", async () => {
    const ip = "198.51.100.7";

    // Past the per-IP ceiling. Each is a distinct address so nothing else
    // throttles them — this isolates the limiter from the cooldown.
    const responses = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        post("/v1/signup", { email: `person${index}@example.com` }, ip)
      )
    );

    const limited = responses.filter((response) => response.status === 429);

    expect(limited.length).toBeGreaterThan(0);
    // The 429 names the wait, because the reader is usually an agent.
    expect(limited[0]?.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("POST /v1/signup/confirm", () => {
  it("mints exactly one tenant, one member and one key", async () => {
    const code = await signUp();
    const response = await post("/v1/signup/confirm", { code, email: EMAIL });

    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      data: { apiKey: string; created: boolean; tenantId: string };
    };

    expect(body.data.created).toBe(true);
    expect(body.data.apiKey).toMatch(AN_API_KEY);

    expect(await db.select().from(tenants)).toHaveLength(1);

    const members = await db.select().from(tenantMembers);

    expect(members).toHaveLength(1);
    expect(members[0]?.email).toBe(EMAIL);
    expect(members[0]?.tenantId).toBe(body.data.tenantId);
  });

  it("returns a key that actually authenticates", async () => {
    const code = await signUp();
    const response = await post("/v1/signup/confirm", { code, email: EMAIL });
    const body = (await response.json()) as { data: { apiKey: string } };

    // The point of the whole flow: the key works without anyone touching a
    // shell. If this fails, self-serve onboarding does not exist.
    const authenticated = await app.request("/v1/domains", {
      headers: { authorization: `Bearer ${body.data.apiKey}` },
    });

    expect(authenticated.status).toBe(200);
  });

  it("refuses a second use of the same code", async () => {
    const code = await signUp();

    await post("/v1/signup/confirm", { code, email: EMAIL });
    const replay = await post("/v1/signup/confirm", { code, email: EMAIL });

    expect(replay.status).toBe(409);
    // And no second account fell out of it.
    expect(await db.select().from(tenants)).toHaveLength(1);
  });

  it("gives one answer to every kind of wrong code", async () => {
    await signUp();

    const wrong = await post("/v1/signup/confirm", {
      code: "000000",
      email: EMAIL,
    });
    const unknown = await post("/v1/signup/confirm", {
      code: "000000",
      email: "nobody@example.com",
    });

    // "wrong code" and "no such signup" must be indistinguishable, for the same
    // reason the signup response is: the difference tells a stranger whether an
    // address is registered here.
    expect(wrong.status).toBe(409);
    expect(unknown.status).toBe(409);
    await expect(wrong.json()).resolves.toEqual(await unknown.json());
  });

  it("counts wrong guesses and kills the code at the cap", async () => {
    const code = await signUp();

    // MAX_ATTEMPTS is five, so six wrong guesses exhausts it. Fired together
    // rather than in sequence, which tests the stronger property: the counter is
    // `attempts + 1` in SQL, so the cap has to hold even when the guesses race.
    await Promise.all(
      Array.from({ length: 6 }, () =>
        post("/v1/signup/confirm", { code: "000000", email: EMAIL })
      )
    );

    // The real code no longer works, which is the property that makes six digits
    // safe to use at all.
    const correct = await post("/v1/signup/confirm", { code, email: EMAIL });

    expect(correct.status).toBe(409);
    expect(await db.select().from(tenants)).toHaveLength(0);
  });

  it("gives a second key on the same tenant when the flow runs again", async () => {
    const first = await signUp();
    const opened = await post("/v1/signup/confirm", {
      code: first,
      email: EMAIL,
    });
    const firstBody = (await opened.json()) as { data: { tenantId: string } };

    const second = await signUp();
    const again = await post("/v1/signup/confirm", {
      code: second,
      email: EMAIL,
    });
    const secondBody = (await again.json()) as {
      data: { apiKey: string; created: boolean; tenantId: string };
    };

    // Idempotency lives at the tenant, not the request: the address maps to one
    // account forever, and re-running the flow is the recovery path for somebody
    // who lost their key rather than a way to accumulate accounts.
    expect(secondBody.data.tenantId).toBe(firstBody.data.tenantId);
    expect(secondBody.data.created).toBe(false);
    expect(await db.select().from(tenants)).toHaveLength(1);
    expect(await db.select().from(tenantMembers)).toHaveLength(1);
  });
});

describe("the marketing list", () => {
  it("adds the address that just confirmed, subscribed", async () => {
    const code = await signUp();

    // Nothing before the mailbox is proved: an address that only asked for a
    // code has not consented to anything, and it may not even be theirs.
    expect(contacts.added).toHaveLength(0);

    await post("/v1/signup/confirm", { code, email: EMAIL });

    expect(contacts.added).toEqual([{ email: EMAIL }]);
  });

  it("adds the normalised address, not what was typed", async () => {
    const code = await signUp("Someone@Example.COM");
    await post("/v1/signup/confirm", { code, email: EMAIL });

    // One mailbox is one account, and it has to be one contact too — otherwise
    // the list accumulates a row per casing somebody happened to use.
    expect(contacts.added).toEqual([{ email: EMAIL }]);
  });

  it("adds nothing when a wrong code is used", async () => {
    await signUp();
    await post("/v1/signup/confirm", { code: "000000", email: EMAIL });

    expect(contacts.added).toHaveLength(0);
  });

  it("does not add again when the flow re-runs", async () => {
    const first = await signUp();
    await post("/v1/signup/confirm", { code: first, email: EMAIL });

    await db.$client`update otp_codes set sent_at = now() - interval '2 minutes'`;

    const second = await signUp();
    await post("/v1/signup/confirm", { code: second, email: EMAIL });

    // Re-running is the recovery path for a lost key, and a second add would
    // send `unsubscribed: false` for somebody who may have unsubscribed since.
    // Resurrecting an unsubscribe is the one failure here that reaches a
    // stranger's inbox rather than our logs.
    expect(contacts.added).toHaveLength(1);
  });

  it("still hands over the key when the list is down", async () => {
    const failing = createRecordingContactList({ failWith: "list down" });
    const scoped = appWith(mailer, failing);

    await post("/v1/signup", { email: EMAIL }, "203.0.113.9", scoped);
    const response = await post(
      "/v1/signup/confirm",
      { code: codeFrom(mailer.sent), email: EMAIL },
      "203.0.113.9",
      scoped
    );

    // The account is the product; the list is not. Failing this would be an
    // outage in the funnel caused by something that is not part of it.
    expect(response.status).toBe(200);
  });

  it("opens accounts with no list configured at all", async () => {
    const withoutList = appWith(mailer);

    await post("/v1/signup", { email: EMAIL }, "203.0.113.10", withoutList);
    const response = await post(
      "/v1/signup/confirm",
      { code: codeFrom(mailer.sent), email: EMAIL },
      "203.0.113.10",
      withoutList
    );

    // What a self-hosted box without RESEND_SEGMENT_ID gets. Unlike the mailer,
    // an absent list does not unmount signup.
    expect(response.status).toBe(200);
  });
});

describe("mounting", () => {
  it("is not mounted without a mailer", async () => {
    const response = await createApp({
      db,
      resolver: { address: "127.0.0.1", port: 53 },
    }).request("/v1/signup", {
      body: JSON.stringify({ email: EMAIL }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    // Storing codes nobody can receive is worse than not offering the endpoint.
    expect(response.status).toBe(404);
  });

  it("needs no key, unlike every other write in the API", async () => {
    // The inverse of what `webhooks.db.spec.ts` pins. That spec exists because a
    // family was once mounted without an auth entry and was silently public;
    // this one exists so somebody fixing that never "fixes" signup too.
    const response = await post("/v1/signup", { email: EMAIL });

    expect(response.status).not.toBe(401);
  });
});
