import { fixtureTarget } from "@propgate/dns-fixtures";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { main } from "./index";

/**
 * `main()` end to end against the live tier.
 *
 * The unit specs cover arguments and formatting separately, which leaves the
 * wiring between them untested — and the wiring is what breaks. Everything here
 * goes through the same entry point a shell would.
 */

const fixture = fixtureTarget("resolver");
const RESOLVER = `${fixture.address}:${fixture.port}`;

let out: string[] = [];
let err: string[] = [];
let writeOut: typeof process.stdout.write;
let writeErr: typeof process.stderr.write;

beforeEach(() => {
  out = [];
  err = [];
  writeOut = process.stdout.write.bind(process.stdout);
  writeErr = process.stderr.write.bind(process.stderr);

  process.stdout.write = ((chunk: string) => {
    out.push(String(chunk));
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk: string) => {
    err.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
});

afterEach(() => {
  process.stdout.write = writeOut;
  process.stderr.write = writeErr;
});

async function propgate(...argv: string[]): Promise<{
  code: number;
  stderr: string;
  stdout: string;
}> {
  // Reset per invocation, not per test: several tests run the CLI twice to
  // compare two flag sets, and shared buffers would make the second call's
  // output contain the first's — which reads as a passing assertion.
  out = [];
  err = [];

  const code = await main(argv);

  return { code, stderr: err.join(""), stdout: out.join("") };
}

describe("a correctly onboarded domain", () => {
  it("exits zero and says there is nothing to fix", async () => {
    const { code, stdout } = await propgate(
      "check",
      "customer.test",
      "--resolver",
      RESOLVER,
      "--selector",
      "pg1",
      "--spf-include",
      "one.spf.test"
    );

    expect(code).toBe(0);
    expect(stdout).toContain("nothing to fix");
  });

  it("does not call a deliberate null MX a problem", async () => {
    // The domain only sends and says so. Nobody told the CLI it should receive
    // mail, so the CLI does not decide that it should.
    const { code, stdout } = await propgate(
      "check",
      "customer.test",
      "--resolver",
      RESOLVER
    );

    expect(code).toBe(0);
    expect(stdout).toContain("MX_NULL");
    expect(stdout).not.toContain("MX_MAIL_NOT_ACCEPTED");
  });

  it("calls it a problem once told the domain receives mail", async () => {
    // Same domain, same records. The flag is the whole difference, and it is
    // the same distinction the API and the web checker make.
    const { code, stdout } = await propgate(
      "check",
      "customer.test",
      "--resolver",
      RESOLVER,
      "--receives-mail"
    );

    expect(code).toBe(1);
    expect(stdout).toContain("MX_MAIL_NOT_ACCEPTED");
  });
});

describe("a domain that was never configured", () => {
  it("exits one and names each missing record", async () => {
    const { code, stdout } = await propgate(
      "check",
      "nodata.test",
      "--resolver",
      RESOLVER,
      "--selector",
      "pg1"
    );

    expect(code).toBe(1);
    expect(stdout).toContain("SPF_RECORD_MISSING");
    expect(stdout).toContain("DKIM_RECORD_MISSING");
    expect(stdout).toContain("DMARC_RECORD_MISSING");
  });
});

describe("--only", () => {
  it("runs just the checks that were asked for", async () => {
    const { stdout } = await propgate(
      "check",
      "customer.test",
      "--resolver",
      RESOLVER,
      "--only",
      "spf"
    );

    expect(stdout).toContain("spf");
    expect(stdout).not.toContain("dmarc");
  });
});

describe("--trace", () => {
  it("prints the queries behind the answer", async () => {
    const withTrace = await propgate(
      "check",
      "customer.test",
      "--resolver",
      RESOLVER,
      "--only",
      "spf",
      "--trace"
    );
    const without = await propgate(
      "check",
      "customer.test",
      "--resolver",
      RESOLVER,
      "--only",
      "spf"
    );

    expect(withTrace.stdout).toContain("TXT");
    expect(withTrace.stdout).toContain("customer.test");
    expect(without.stdout).not.toContain("TXT ");
  });
});

describe("--json", () => {
  it("emits the same shape the API does", async () => {
    const { stdout } = await propgate(
      "check",
      "customer.test",
      "--resolver",
      RESOLVER,
      "--only",
      "mx",
      "--json"
    );

    const parsed = JSON.parse(stdout);

    expect(parsed.domain).toBe("customer.test");
    expect(parsed.verdict).toBe("pass");
    // The taxonomy travels with the finding, exactly as over HTTP, so a script
    // reading either surface needs no copy of the registry.
    expect(parsed.checks[0].findings[0].code).toBe("MX_NULL");
    expect(parsed.checks[0].findings[0].slug).toBe("mx-null");
    expect(parsed.checks[0].findings[0].summary.length).toBeGreaterThan(20);
  });

  it("emits no colour, whatever the terminal is", async () => {
    const { stdout } = await propgate(
      "check",
      "customer.test",
      "--resolver",
      RESOLVER,
      "--only",
      "mx",
      "--json"
    );

    expect(() => JSON.parse(stdout)).not.toThrow();
  });
});

describe("could not tell is not a failure", () => {
  it("exits two when the resolver is unreachable", async () => {
    // The distinction the resolver keeps all the way down, surviving to the one
    // place a script reads it. A deploy must not go red over a network blip.
    const { code, stdout } = await propgate(
      "check",
      "customer.test",
      "--resolver",
      "127.0.0.1:1",
      "--only",
      "spf"
    );

    expect(code).toBe(2);
    expect(stdout).toContain("could not be completed");
  });
});

describe("usage errors are not verdicts", () => {
  it("exits 64 for an unknown flag, and says so on stderr", async () => {
    const { code, stderr, stdout } = await propgate(
      "check",
      "customer.test",
      "--stritc"
    );

    expect(code).toBe(64);
    expect(stderr).toContain("propgate:");
    expect(stdout).toBe("");
  });

  it("exits 64 for a resolver that is not an address and port", async () => {
    const { code } = await propgate(
      "check",
      "customer.test",
      "--resolver",
      "1.1.1.1:0"
    );

    expect(code).toBe(64);
  });
});
