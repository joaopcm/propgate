import { describe, expect, it } from "vitest";
import { createApp } from "../app";
import { rejectDomain } from "../utils/domain-name";
import { CHECKS_PER_MINUTE } from "./checks";

const app = createApp({ resolver: { address: "127.0.0.1", port: 1 } });

async function post(body: unknown, headers: Record<string, string> = {}) {
  return await app.request("/v1/checks", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
}

describe("rejectDomain", () => {
  it("accepts an ordinary domain", () => {
    expect(rejectDomain("example.com")).toBeNull();
    expect(rejectDomain("mail.example.co.uk")).toBeNull();
    expect(rejectDomain("example.com.")).toBeNull();
  });

  it("rejects a name that is itself a public suffix", () => {
    expect(rejectDomain("co.uk")).toContain("public suffix");
    expect(rejectDomain("github.io")).toContain("public suffix");
  });

  it("rejects a single label before reaching the suffix list", () => {
    expect(rejectDomain("com")).toContain("two labels");
    expect(rejectDomain("localhost")).toContain("two labels");
  });

  it("rejects malformed labels", () => {
    expect(rejectDomain("-bad.example.com")).toContain("not a valid domain");
    expect(rejectDomain("bad-.example.com")).toContain("not a valid domain");
    expect(rejectDomain("a..example.com")).toContain("not a valid domain");
    expect(rejectDomain("exam ple.com")).toContain("not a valid domain");
  });

  it("rejects a name over the length limit", () => {
    const long = `${`${"a".repeat(60)}.`.repeat(5)}example.com`;

    expect(rejectDomain(long)).toContain("253");
  });
});

describe("request validation", () => {
  it("rejects a body that is not JSON", async () => {
    const response = await post("not json");

    expect(response.status).toBe(422);
  });

  it("rejects a missing domain", async () => {
    const response = await post({ expectsMail: true });

    expect(response.status).toBe(422);
  });

  it("rejects an unknown check kind", async () => {
    const response = await post({ checks: ["whois"], domain: "example.com" });

    expect(response.status).toBe(422);
  });

  it("explains why in the error envelope", async () => {
    const response = await post({ domain: "co.uk" });
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.data).toBeNull();
    expect(body.error.message).toContain("public suffix");
  });
});

describe("rate limiting", () => {
  it("allows a burst up to the limit and refuses the next", async () => {
    const fresh = createApp({ resolver: { address: "127.0.0.1", port: 1 } });
    const headers = { "x-forwarded-for": "203.0.113.7" };

    const send = () =>
      fresh.request("/v1/checks", {
        body: JSON.stringify({ domain: "com" }),
        headers: { "content-type": "application/json", ...headers },
        method: "POST",
      });

    const statuses: number[] = [];

    for (let index = 0; index < CHECKS_PER_MINUTE + 1; index += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: the assertion is about order
      statuses.push((await send()).status);
    }

    expect(statuses.slice(0, CHECKS_PER_MINUTE)).toEqual(
      Array.from({ length: CHECKS_PER_MINUTE }, () => 422)
    );
    expect(statuses.at(-1)).toBe(429);
  });

  it("counts clients separately, and says when to come back", async () => {
    const fresh = createApp({ resolver: { address: "127.0.0.1", port: 1 } });

    const send = (ip: string) =>
      fresh.request("/v1/checks", {
        body: JSON.stringify({ domain: "com" }),
        headers: { "content-type": "application/json", "x-forwarded-for": ip },
        method: "POST",
      });

    for (let index = 0; index < CHECKS_PER_MINUTE + 1; index += 1) {
      // biome-ignore lint/performance/noAwaitInLoops: exhausting one client's window in order
      await send("198.51.100.1");
    }

    const other = await send("198.51.100.2");
    const limited = await send("198.51.100.1");

    expect(other.status).toBe(422);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});

describe("health", () => {
  it("still answers", async () => {
    const response = await app.request("/health");

    expect(response.status).toBe(200);
  });
});
