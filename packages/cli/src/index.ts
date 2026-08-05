import { getServers } from "node:dns";
import {
  CHECK_KINDS,
  type CheckResult,
  DIAGNOSIS_REGISTRY,
  type DomainProfile,
  runChecks,
  type ServerAddress,
} from "@propgate/dns";
import { ACCOUNT_USAGE, isAccountCommand, runAccountCommand } from "./account";
import { type Options, parse, parseResolver, USAGE } from "./args";
import { exitCodeFor, render, type Style } from "./report";
import { version } from "./version";

/**
 * `propgate check <domain>`
 *
 * The same engine as the public checker and the API. Three surfaces, one
 * implementation — and this is the one to reach for when a customer reports
 * something odd, because it runs against whichever resolver *they* are using
 * rather than against ours.
 */

/** Generous enough that a slow authority is not mistaken for a dead one. */
const BUDGET_MS = 15_000;
const TIMEOUT_MS = 4000;
const MAX_LOOKUPS = 100;

const TRAILING_DOT = /\.$/;

/** Reserved for "you asked for something impossible", distinct from any verdict. */
const EXIT_USAGE = 64;

/**
 * The resolver to query when none was given.
 *
 * `node:dns` is read here for its *configuration* — `getServers` returns what
 * the machine is set up with and makes no query. The package's rule is that
 * nothing resolves through c-ares, and nothing does: every packet is still
 * built and parsed by `@propgate/dns`.
 */
function systemResolver(): ServerAddress | string {
  const [first] = getServers();

  if (first === undefined) {
    return "no resolver is configured on this machine; pass --resolver";
  }

  return parseResolver(first);
}

function profileFor(options: Options): DomainProfile {
  return {
    checks: options.checks ?? [...CHECK_KINDS],
    id: "cli",
    ...(options.expectsMail === undefined
      ? {}
      : { expectsMail: options.expectsMail }),
    ...(options.caaIssuer === undefined
      ? {}
      : { caaIssuer: options.caaIssuer }),
    ...(options.selectors.length === 0
      ? {}
      : { dkimSelectors: options.selectors }),
    ...(options.spfInclude === undefined
      ? {}
      : { spfInclude: options.spfInclude }),
  };
}

/** The machine-readable form, carrying the taxonomy exactly as the API does. */
function toJson(result: CheckResult) {
  return {
    checks: result.checks.map((outcome) => ({
      findings: outcome.findings.map((finding) => ({
        code: finding.code,
        evidence: finding.evidence,
        severity: finding.severity,
        slug: DIAGNOSIS_REGISTRY[finding.code].slug,
        summary: DIAGNOSIS_REGISTRY[finding.code].summary,
      })),
      kind: outcome.kind,
      lookups: outcome.lookups.map((lookup) => ({
        name: lookup.name,
        purpose: lookup.purpose,
        server: `${lookup.server.address}:${lookup.server.port}`,
        status: lookup.outcome.status,
        type: lookup.type,
      })),
      verdict: outcome.verdict,
    })),
    domain: result.domain,
    verdict: result.verdict,
  };
}

async function check(options: Options): Promise<number> {
  const resolver =
    options.resolver === undefined
      ? systemResolver()
      : parseResolver(options.resolver);

  if (typeof resolver === "string") {
    process.stderr.write(`propgate: ${resolver}\n`);
    return EXIT_USAGE;
  }

  const result = await runChecks({
    domain: options.domain.trim().replace(TRAILING_DOT, "").toLowerCase(),
    profile: profileFor(options),
    resolver: {
      budgetMs: BUDGET_MS,
      maxLookups: MAX_LOOKUPS,
      recursionDesired: true,
      target: resolver,
      timeoutMs: TIMEOUT_MS,
    },
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(toJson(result), null, 2)}\n`);
  } else {
    // Colour off when stdout is not a terminal, so a pipe stays clean.
    const style: Style = { colour: process.stdout.isTTY === true };

    process.stdout.write(
      `${render(result, { style, trace: options.trace }).join("\n")}\n`
    );
  }

  return exitCodeFor(result);
}

export async function main(argv: readonly string[]): Promise<number> {
  const [first] = argv;

  /**
   * Account commands are routed before the check parser sees the arguments.
   *
   * Not for tidiness: `parseArgs` throws on an unknown flag, so `--email` would be
   * an error rather than a command if this ran afterwards. Routing on the verb also
   * keeps the two option tables disjoint, which is what stops
   * `propgate check example.com --code 123456` from parsing.
   */
  if (first !== undefined && isAccountCommand(first)) {
    if (argv.includes("--help") || argv.includes("-h")) {
      process.stdout.write(ACCOUNT_USAGE);

      return 0;
    }

    return await runAccountCommand(argv);
  }

  const parsed = parse(argv);

  if (parsed.kind === "help") {
    process.stdout.write(USAGE);
    return 0;
  }

  if (parsed.kind === "version") {
    process.stdout.write(`${version()}\n`);
    return 0;
  }

  if (parsed.kind === "error") {
    process.stderr.write(`propgate: ${parsed.message}\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  return await check(parsed.options);
}

// tsup adds the shebang; this guard keeps the module importable from tests.
if (process.argv[1]?.endsWith("index.js")) {
  process.exitCode = await main(process.argv.slice(2));
}
