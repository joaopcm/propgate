import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { main } from "@propgate/cli";
import type { Database } from "@propgate/db";
import { createDb, truncateAll } from "@propgate/db";
import { fixtureTarget } from "@propgate/dns-fixtures";
import type { RecordingMailer } from "@propgate/emails";
import { createRecordingMailer } from "@propgate/emails";
import type { DeliverWebhookPayload } from "@propgate/jobs";
import {
  connectionFor,
  deliverWebhookQueue,
  QUEUE_NAMES,
  testPrefix,
  testRedisUrl,
} from "@propgate/jobs";
import type { WebhookPayload } from "@propgate/webhooks";
import { verifyPayload } from "@propgate/webhooks";
import { Worker } from "bullmq";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app";
import { attemptDelivery } from "../webhooks/deliver";

const db: Database = createDb(process.env.DATABASE_URL ?? "", {
  maxConnections: 4,
});

const REDIS = testRedisUrl();

const DKIM_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApbBuIv1NwQ/rmgGPN8OufvLBfd2asvyk4ajVkiW2CsC12MohickhGufJPsGNyO/ZXD4b/HnClukz07BZwpJe80wz0w/AfhJCqM8F3v/aVHF7wWnd9wBBPBroTL7kNx5u39NnBZZj8SYJF7zNaQ3rud4ekF+GAyTovT7MUfXHQBgEZn0n5Y4dN7b7VEMi4/97TDCNDJucFywdDmbJ9r6LaCu+l+gWfZGl4rDimTJCw3oCQIpCOGlNrWPwxRLuB0sLR2gR1GT9EqBg3yGforXasq2wqBuZlpI1YXmdldEZh3VRIyft4TeVTHRJAf7/TKuAINb8+LOoXHj5hFYl+C4zUQIDAQAB";

const CODE_IN_MAIL = /\b(\d{6})\b/;
const SIX_DIGITS = 6;
const SETTLE_POLL_MS = 20;
const SETTLE_ATTEMPTS = 150;
const DELIVERY_TIMEOUT_MS = 2000;
const DELIVERY_ATTEMPTS = 3;

function allowLoopbackWebhookUrl(raw: string): string | null {
  return raw.startsWith("http://127.0.0.1:")
    ? null
    : `${raw} is not the loopback receiver this spec serves`;
}

function vantage(role: "auth" | "divergent") {
  const fixture = fixtureTarget(role);

  return { address: fixture.address, port: fixture.port };
}

const AUTH = vantage("auth");
const DIVERGENT = vantage("divergent");

interface Harness {
  readonly delivered: WebhookPayload[];
  readonly forged: string[];
  readonly mailer: RecordingMailer;
  readonly receiverUrl: string;
  serveFrom: (role: "honest" | "stale") => void;
  setSecret: (secret: string) => void;
  readonly url: () => string;
}

let harness: Harness;
let closers: (() => Promise<void>)[] = [];

async function start(): Promise<Harness> {
  const delivered: WebhookPayload[] = [];
  const forged: string[] = [];
  const mailer = createRecordingMailer();
  let secret = "";

  const receiver = createServer((request, response) => {
    let raw = "";

    request.on("data", (chunk) => {
      raw += chunk;
    });
    request.on("end", () => {
      const verified = verifyPayload({
        body: raw,
        header: String(request.headers["webhook-signature"]),
        id: String(request.headers["webhook-id"]),
        secret,
        timestamp: Number(request.headers["webhook-timestamp"]),
      });

      if (verified) {
        delivered.push(JSON.parse(raw) as WebhookPayload);
        response.writeHead(200).end();

        return;
      }

      forged.push(raw);
      response.writeHead(400).end();
    });
  });

  await new Promise<void>((resolve) => {
    receiver.listen(0, "127.0.0.1", () => resolve());
  });

  const prefix = testPrefix("cli-e2e");
  const queue = deliverWebhookQueue({ prefix, url: REDIS });

  const worker = new Worker<DeliverWebhookPayload>(
    QUEUE_NAMES.deliverWebhook,
    async (job) => {
      const result = await attemptDelivery(
        { db, timeoutMs: DELIVERY_TIMEOUT_MS },
        job.data,
        { allowed: DELIVERY_ATTEMPTS, made: job.attemptsMade + 1 }
      );

      if (result.kind === "retry") {
        throw new Error(result.error);
      }

      return { kind: result.kind };
    },
    { concurrency: 1, connection: connectionFor(REDIS), prefix }
  );

  const servers = await Promise.all(
    [AUTH, DIVERGENT].map(async (server) => {
      const app = createApp({
        db,
        mailer,
        resolver: server,
        resolvers: [server],
        webhooks: queue,
        webhookUrlPolicy: allowLoopbackWebhookUrl,
      });
      const running = serve({
        fetch: app.fetch,
        hostname: "127.0.0.1",
        port: 0,
      });

      await new Promise((resolve) => {
        running.once("listening", resolve);
      });

      return running;
    })
  );

  const [honest, stale] = servers;
  const portOf = (server: (typeof servers)[number]) =>
    (server.address() as { port: number }).port;
  const urls = {
    honest: `http://127.0.0.1:${portOf(honest as (typeof servers)[number])}`,
    stale: `http://127.0.0.1:${portOf(stale as (typeof servers)[number])}`,
  };

  let current: "honest" | "stale" = "honest";

  closers = [
    async () => await worker.close(),
    async () => {
      await queue.obliterate({ force: true });
      await queue.close();
    },
    ...servers.map(
      (server) => async () =>
        await new Promise<void>((resolve) => {
          server.close(() => resolve());
        })
    ),
    async () =>
      await new Promise<void>((resolve) => {
        receiver.close(() => resolve());
      }),
  ];

  return {
    delivered,
    forged,
    mailer,
    receiverUrl: `http://127.0.0.1:${(receiver.address() as { port: number }).port}/hook`,
    serveFrom(role) {
      current = role;
    },
    setSecret(value) {
      secret = value;
    },
    url: () => urls[current],
  };
}

async function propgate(...argv: string[]): Promise<{
  code: number;
  stderr: string;
  stdout: string;
}> {
  const out: string[] = [];
  const err: string[] = [];
  const writeOut = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string) => {
    out.push(String(chunk));

    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string) => {
    err.push(String(chunk));

    return true;
  }) as typeof process.stderr.write;

  try {
    const code = await main([...argv, "--api-url", harness.url()]);

    return { code, stderr: err.join(""), stdout: out.join("") };
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
}

interface Envelope<T> {
  readonly data: T;
  readonly meta: Record<string, unknown> | null;
}

async function json<T>(...argv: string[]): Promise<Envelope<T>> {
  const { code, stderr, stdout } = await propgate(...argv, "--json");

  if (code !== 0) {
    throw new Error(
      `propgate ${argv.join(" ")} exited ${code}: ${stderr}${stdout}`
    );
  }

  return JSON.parse(stdout) as Envelope<T>;
}

async function settled(expected: number): Promise<void> {
  for (let attempt = 0; attempt < SETTLE_ATTEMPTS; attempt += 1) {
    const done = harness.delivered.length >= expected;

    // biome-ignore lint/performance/noAwaitInLoops: polling is sequential by definition
    await new Promise((resolve) => setTimeout(resolve, SETTLE_POLL_MS));

    if (done) {
      return;
    }
  }
}

function events(): string[] {
  return harness.delivered.map((payload) => payload.type);
}

beforeEach(async () => {
  await truncateAll(db);

  process.env.XDG_CONFIG_HOME = mkdtempSync(join(tmpdir(), "propgate-e2e-"));
  process.env.PROPGATE_NO_INPUT = "1";
  delete process.env.PROPGATE_API_KEY;

  harness = await start();
});

afterEach(async () => {
  for (const close of closers) {
    // biome-ignore lint/performance/noAwaitInLoops: teardown is ordered on purpose
    await close();
  }

  closers = [];
});

afterAll(async () => {
  await db.$client.end();
});

async function onboard(): Promise<{ confirm: string; signup: number }> {
  const started = await propgate("signup", "--email", "partner@example.com");

  if (started.code !== 0) {
    throw new Error(`signup exited ${started.code}: ${started.stderr}`);
  }

  const code = CODE_IN_MAIL.exec(harness.mailer.sent.at(-1)?.text ?? "")?.[1];

  if (code?.length !== SIX_DIGITS) {
    throw new Error(
      `no six-digit code in: ${harness.mailer.sent.at(-1)?.text ?? "(nothing sent)"}`
    );
  }

  const confirmed = await propgate(
    "confirm",
    "--email",
    "partner@example.com",
    "--code",
    code
  );

  if (confirmed.code !== 0) {
    throw new Error(`confirm exited ${confirmed.code}: ${confirmed.stderr}`);
  }

  return { confirm: confirmed.stdout, signup: started.code };
}

async function subscribe(): Promise<string> {
  const created = await json<{ id: string; secret: string }>(
    "webhooks",
    "create",
    "--url",
    harness.receiverUrl
  );

  harness.setSecret(created.data.secret);

  return created.data.id;
}

async function profile(key: string, ...requirements: string[]): Promise<void> {
  await json(
    "profiles",
    "create",
    "--key",
    key,
    ...requirements.flatMap((requirement) => ["--require", requirement])
  );
}

describe("a partner onboarding a domain from the terminal", () => {
  it("goes from no account to a verified domain and a signed webhook", async () => {
    await onboard();
    await subscribe();
    await profile(
      "sending",
      "dkim:dkim:selector=pg1,requiredPerDomain=expectedPublicKey",
      "dmarc:dmarc",
      "apex:mx:expectsMail=false",
      "bounce-spf:spf:include=one.spf.test,label=send",
      "bounce-mx:mx:expectsMail=true,label=send"
    );

    const refused = await propgate(
      "domains",
      "add",
      "customer.test",
      "--profile",
      "sending"
    );

    expect(refused.code).not.toBe(0);
    expect(refused.stderr).toContain("expectations.dkim.expectedPublicKey");

    const added = await json<{ id: string; state: string }>(
      "domains",
      "add",
      "customer.test",
      "--profile",
      "sending",
      "--external-id",
      "cust_1",
      "--expect",
      `dkim.expectedPublicKey=${DKIM_KEY}`
    );

    expect(added.data.state).toBe("pending");
    expect(harness.delivered).toHaveLength(0);

    const checked = await json<{
      requirementsMet: number;
      requirementsTotal: number;
      state: string;
    }>("domains", "check", added.data.id);

    expect(checked.data.state).toBe("verified");
    expect(checked.data.requirementsMet).toBe(checked.data.requirementsTotal);

    await settled(1);

    expect(events()).toEqual(["domain.verified"]);
    expect(harness.forged).toHaveLength(0);
    expect(harness.delivered[0]?.data).toMatchObject({
      domain: "customer.test",
      external_id: "cust_1",
      previous_state: "pending",
      state: "verified",
    });
  });

  it("appends to the timeline only when an observation actually differs", async () => {
    await onboard();
    await profile("sending", "dkim:dkim:selector=pg1");

    const added = await json<{ id: string }>(
      "domains",
      "add",
      "customer.test",
      "--profile",
      "sending"
    );

    await json("domains", "check", added.data.id);

    const first = await json<unknown[]>("domains", "timeline", added.data.id);

    await json("domains", "check", added.data.id);

    const second = await json<unknown[]>("domains", "timeline", added.data.id);

    expect(second.data).toHaveLength(first.data.length);
  });
});

describe("a domain that breaks and comes back", () => {
  async function arc(): Promise<string> {
    await onboard();
    await subscribe();
    await profile(
      "arc",
      "dkim:dkim:selector=pg1,requiredPerDomain=expectedPublicKey"
    );

    const added = await json<{ id: string }>(
      "domains",
      "add",
      "split.test",
      "--profile",
      "arc",
      "--expect",
      `dkim.expectedPublicKey=${DKIM_KEY}`
    );

    return added.data.id;
  }

  async function check(id: string): Promise<string> {
    const result = await json<{ state: string }>("domains", "check", id);

    return result.data.state;
  }

  it("fires one event per episode, not one per check", async () => {
    const id = await arc();

    expect(await check(id)).toBe("verified");
    await settled(1);

    harness.serveFrom("stale");

    expect(await check(id)).toBe("degraded");
    await settled(2);

    expect(await check(id)).toBe("degraded");
    expect(await check(id)).toBe("failed");
    await settled(3);

    harness.serveFrom("honest");

    expect(await check(id)).toBe("verified");
    await settled(4);

    expect(events()).toEqual([
      "domain.verified",
      "domain.degraded",
      "domain.failed",
      "domain.recovered",
    ]);
    expect(harness.forged).toHaveLength(0);
  });

  it("says nothing when the value we compare against is the one that changed", async () => {
    const id = await arc();

    expect(await check(id)).toBe("verified");
    await settled(1);

    const rotated = await json<{ state: string }>(
      "domains",
      "update",
      id,
      "--expect",
      `dkim.expectedPublicKey=${DKIM_KEY.slice(0, -4)}AAAA`
    );

    expect(rotated.data.state).toBe("pending");

    expect(await check(id)).toBe("pending");
    expect(await check(id)).toBe("pending");
    expect(await check(id)).toBe("failed");
    await settled(2);

    expect(events()).toEqual(["domain.verified", "domain.failed"]);
    expect(events()).not.toContain("domain.degraded");
  });
});

describe("the wire between the CLI and the API", () => {
  it("walks every page of a paginated list", async () => {
    await onboard();
    await profile("sending", "dkim:dkim:selector=pg1");

    for (const name of ["customer.test", "healthy.test", "split.test"]) {
      // biome-ignore lint/performance/noAwaitInLoops: registration order is the paging order
      await json("domains", "add", name, "--profile", "sending");
    }

    const page = await json<{ id: string }[]>(
      "domains",
      "list",
      "--limit",
      "1"
    );

    expect(page.data).toHaveLength(1);
    expect(page.meta?.nextCursor).toEqual(expect.any(String));

    const all = await json<{ id: string }[]>("domains", "list", "--all");

    expect(all.data).toHaveLength(3);
  });

  it("mints a key from a code that only ever existed in the mail", async () => {
    const { confirm } = await onboard();

    expect(harness.mailer.sent).toHaveLength(1);
    expect(confirm).toContain("Account created.");
    expect(confirm).toContain("It will not be shown again.");
  });

  it("reads the key the CLI stored rather than one handed to it", async () => {
    await onboard();

    const members = await json<{ email: string }[]>("members", "list");

    expect(members.data.map((member) => member.email)).toEqual([
      "partner@example.com",
    ]);
  });

  it("surfaces a server-side refusal as a usable message and a non-zero exit", async () => {
    await onboard();

    const { code, stderr } = await propgate(
      "webhooks",
      "create",
      "--url",
      "http://example.com/hook"
    );

    expect(code).not.toBe(0);
    expect(stderr).toContain("https");
  });
});
