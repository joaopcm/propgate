import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  ENDPOINTS,
  type Endpoint,
  REQUIREMENT_TYPES,
  VERDICTS,
} from "@/lib/api";

/**
 * The partner-facing reference.
 *
 * One page rather than several, because an integrator reads it top to bottom
 * once and searches it afterwards. The requirement types and verdicts are
 * rendered from `lib/api.ts`, which is keyed by types from `@propgate/dns` so
 * the page cannot fall behind the code.
 */

export const metadata: Metadata = {
  // No endpoint count. It said "seven" while the list had grown to thirteen,
  // which is what a hardcoded tally of something rendered from a list does.
  description:
    "Sign up for a key, register domains, verify them, and read per-requirement results. Bearer authentication and four verdicts.",
  title: "API reference",
};

const METHOD_STYLE = {
  DELETE: "text-[var(--color-destructive)]",
  GET: "text-muted-foreground",
  POST: "text-[var(--color-warning)]",
} as const;

function Section({
  children,
  id,
  title,
}: {
  children: ReactNode;
  id: string;
  title: string;
}) {
  return (
    <section className="mb-14" id={id}>
      <h2 className="mb-4 font-semibold text-xl tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

function Code({ children }: { children: string }) {
  return (
    <pre className="mb-4 overflow-x-auto rounded-md border border-white/5 bg-black/30 p-4 font-mono text-[0.8125rem] leading-6">
      <code>{children}</code>
    </pre>
  );
}

function EndpointRow({ endpoint }: { endpoint: Endpoint }) {
  return (
    <li className="flex flex-col gap-1 border-white/5 border-b py-3 last:border-0 sm:flex-row sm:items-baseline sm:gap-4">
      <span
        className={`shrink-0 font-mono text-[0.6875rem] uppercase tracking-widest ${METHOD_STYLE[endpoint.method]}`}
      >
        {endpoint.method}
      </span>
      <code className="shrink-0 font-mono text-sm">{endpoint.path}</code>
      <span className="flex-1 text-muted-foreground text-sm leading-6">
        {endpoint.summary}
      </span>
    </li>
  );
}

export default function ApiReferencePage() {
  return (
    <>
      <h1 className="mb-6 font-semibold text-3xl tracking-tight">
        API reference
      </h1>

      <p className="mb-3 text-muted-foreground leading-7">
        You keep the list of domains. You register each one against a profile,
        ask us to verify it, and read back which of your requirements are met
        and which are not. We do not render instructions for your customers —
        you already have a UI for that, and being wrong about a provider&apos;s
        naming conventions is visible to your customer, not to us.
      </p>
      <p className="mb-10 text-muted-foreground leading-7">
        Base URL{" "}
        <code className="font-mono text-sm">https://api.propgate.dev</code>.
      </p>

      <Section id="accounts" title="Getting a key">
        <p className="mb-4 text-muted-foreground leading-7">
          Two calls, no sales conversation. The first sends a six-digit code to
          the address you give it; the second exchanges that code for a key.
        </p>
        <Code>{`curl -X POST https://api.propgate.dev/v1/signup \\
  -H "content-type: application/json" \\
  -d '{"email":"you@example.com"}'

curl -X POST https://api.propgate.dev/v1/signup/confirm \\
  -H "content-type: application/json" \\
  -d '{"email":"you@example.com","code":"123456"}'`}</Code>
        <p className="mb-4 text-muted-foreground leading-7">
          The code is valid for ten minutes and single-use. Confirmation returns
          your key once — only a hash is stored, so no endpoint can show it
          again.
        </p>
        <p className="mb-4 text-muted-foreground leading-7">
          <code className="font-mono text-sm">POST /v1/signup</code> answers
          identically whether or not the address already has an account. That is
          deliberate: a signup endpoint that says <em>already registered</em>{" "}
          tells whoever holds a leaked address list which of those addresses use
          us.
        </p>
        <p className="mb-4 text-muted-foreground leading-7">
          Running the flow again on an address that already has an account mints
          an <strong>additional</strong> key against the same account rather
          than a second account. That is also the recovery path if you lose a
          key, which is why there is no separate sign-in.
        </p>
        <p className="text-muted-foreground leading-7">
          Or from the terminal, which stores the key for you:
        </p>
        <Code>{`npx @propgate/cli signup  --email you@example.com
npx @propgate/cli confirm --email you@example.com --code 123456`}</Code>
      </Section>

      <Section id="authentication" title="Authentication">
        <p className="mb-4 text-muted-foreground leading-7">
          A bearer token on every request. Keys are stored hashed; the plaintext
          is shown once when the key is issued and cannot be recovered
          afterwards.
        </p>
        <Code>{`curl https://api.propgate.dev/v1/domains \\
  -H "Authorization: Bearer pg_live_..."`}</Code>
        <p className="text-muted-foreground leading-7">
          A <code className="font-mono text-sm">401</code> distinguishes a key
          we do not recognise from one that has been revoked. You hold the key
          either way, so saying which saves you looking for a typo that is not
          there.
        </p>
      </Section>

      <Section id="responses" title="Responses">
        <p className="mb-4 text-muted-foreground leading-7">
          Every response — success and error alike — is the same envelope, so
          you write one unwrap path rather than one per status code.
        </p>
        <Code>{`{ "data": { ... }, "error": null, "meta": null }
{ "data": null, "error": { "message": "..." }, "meta": null }`}</Code>
        <p className="text-muted-foreground leading-7">
          Error messages name the thing that is wrong and the value that would
          fix it. They are written to be actionable by the agent reading them,
          not just by a human.
        </p>
      </Section>

      <Section id="profiles" title="Profiles">
        <p className="mb-4 text-muted-foreground leading-7">
          A profile is what you expect of a domain&apos;s records: a list of
          requirements, each with a key you choose. Results are reported against
          those keys, so pick ones you can switch on.
        </p>
        <Code>{`POST /v1/profiles
{
  "key": "sending",
  "requirements": [
    { "key": "spf",   "check": "spf",   "include": "_spf.yourplatform.com" },
    { "key": "dkim",  "check": "dkim",  "selector": "pg1" },
    { "key": "dmarc", "check": "dmarc" },
    { "key": "mail",  "check": "mx",    "expectsMail": false }
  ]
}`}</Code>
        <p className="mb-4 text-muted-foreground leading-7">
          <strong className="font-medium text-foreground">
            Editing a profile writes a new version.
          </strong>{" "}
          It never changes an existing one, and a domain stays pinned to the
          version it was registered against. Without that, editing a profile
          silently reclassifies every domain using it at once — which, once
          webhooks exist, is a storm your customers receive with no deploy
          behind it.
        </p>
        <p className="text-muted-foreground leading-7">
          A definition is rejected at write time if any requirement could never
          be answered: a duplicate key, two requirements competing for one
          check, a DKIM requirement with no selector, a CAA requirement with no
          issuer. Accepting those and failing later would be a promise this API
          cannot keep.
        </p>
      </Section>

      <Section id="requirements" title="Requirement types">
        <p className="mb-6 text-muted-foreground leading-7">
          Limited to what the evaluators actually assert. Anything not listed
          here is not something we can currently report on.
        </p>
        <ul>
          {Object.entries(REQUIREMENT_TYPES).map(([kind, type]) => (
            <li
              className="border-white/5 border-b py-4 last:border-0"
              key={kind}
            >
              <div className="mb-1 flex items-baseline gap-3">
                <code className="font-mono text-sm">{kind}</code>
                {type.repeatable ? (
                  <span className="font-mono text-[0.6875rem] text-[var(--color-warning)] uppercase tracking-widest">
                    repeatable
                  </span>
                ) : null}
              </div>
              <p className="mb-2 text-muted-foreground text-sm leading-6">
                {type.summary}
              </p>
              {type.fields.length > 0 ? (
                <ul className="list-inside list-disc text-muted-foreground text-sm leading-6">
                  {type.fields.map((field) => (
                    <li key={field.name}>
                      <code className="font-mono text-xs">{field.name}</code> —{" "}
                      {field.note}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </Section>

      <Section id="endpoints" title="Endpoints">
        <ul className="mb-6">
          {ENDPOINTS.map((endpoint) => (
            <EndpointRow
              endpoint={endpoint}
              key={`${endpoint.method} ${endpoint.path}`}
            />
          ))}
        </ul>
        <p className="text-muted-foreground leading-7">
          <strong className="font-medium text-foreground">
            Registration and verification are separate calls.
          </strong>{" "}
          Registration is a write and returns immediately; verification has
          latency and side effects. Importing tens of thousands of domains must
          not fire tens of thousands of DNS runs as a side effect of a bulk
          insert.
        </p>
      </Section>

      <Section id="registering" title="Registering a domain">
        <Code>{`POST /v1/domains
{ "name": "customer.example", "profile": "sending", "externalId": "cust_1841" }`}</Code>
        <p className="mb-4 text-muted-foreground leading-7">
          <code className="font-mono text-sm">externalId</code> is your
          identifier for this domain, unique within your account and optional.
          Re-sending one returns the existing domain rather than erroring — that
          is what your retry logic does, and it removes the mapping table on
          your side. <code className="font-mono text-sm">meta.created</code>{" "}
          tells a retry apart from a new customer.
        </p>
        <p className="text-muted-foreground leading-7">
          Registering a name that already exists under a <em>different</em>{" "}
          external id is a <code className="font-mono text-sm">409</code>. That
          is two records of one domain, and quietly returning one of them would
          hide it.
        </p>
      </Section>

      <Section id="verifying" title="Verifying">
        <Code>{`POST /v1/domains/:id/checks

{
  "data": {
    "id": "019fbf...",
    "name": "customer.example",
    "state": "failed",
    "verdict": "fail",
    "requirementsMet": 3,
    "requirementsTotal": 4,
    "requirements": [
      { "key": "spf",   "satisfied": true,  "verdict": "pass", "findings": [] },
      { "key": "dkim",  "satisfied": false, "verdict": "fail",
        "findings": [
          { "code": "DKIM_RECORD_MISSING",
            "name": "pg1._domainkey.customer.example" }
        ] },
      { "key": "dmarc", "satisfied": true,  "verdict": "warn",
        "findings": [ { "code": "DMARC_POLICY_NONE", "observed": "p=none" } ] },
      { "key": "mail",  "satisfied": true,  "verdict": "pass",
        "findings": [ { "code": "MX_NULL", "observed": "0 ." } ] }
    ]
  }
}`}</Code>
        <p className="mb-4 text-muted-foreground leading-7">
          Every finding carries a{" "}
          <Link className="underline" href="/taxonomy">
            diagnosis code
          </Link>
          , and where the evaluator has them, the DNS{" "}
          <code className="font-mono text-sm">name</code> it concerns, what was{" "}
          <code className="font-mono text-sm">observed</code>, and what was{" "}
          <code className="font-mono text-sm">expected</code>. Codes are a
          stable public contract: switching on one is supported, and changing or
          removing one is a breaking change.
        </p>
        <p className="text-muted-foreground leading-7">
          Findings appear on satisfied requirements too. The{" "}
          <code className="font-mono text-sm">MX_NULL</code> above is an
          observation at info severity, not something to fix — the domain says
          it accepts no mail, which is exactly what{" "}
          <code className="font-mono text-sm">expectsMail: false</code>{" "}
          asserted. Read <code className="font-mono text-sm">satisfied</code>,
          not the presence of findings.
        </p>
      </Section>

      <Section id="listing" title="Listing and reconciling">
        <Code>{`GET /v1/domains?limit=200&cursor=019fbf...&state=failed
GET /v1/domains?externalId=cust_1841

{ "data": [ { "object": "domain", ... } ],
  "meta": { "nextCursor": "019fbf..." } }`}</Code>
        <p className="mb-4 text-muted-foreground leading-7">
          Paging is by cursor, not offset, and ordered oldest first. Pass{" "}
          <code className="font-mono text-sm">meta.nextCursor</code> back until
          it is null. Domains registered while you are walking land after the
          cursor and appear at the end, so a full walk never misses a row it had
          not reached yet.
        </p>
        <p className="mb-4 text-muted-foreground leading-7">
          <code className="font-mono text-sm">externalId</code> is the filter to
          reach for if you did not keep our ids — your own identifier is enough
          to find a domain again.
        </p>
        <p className="text-muted-foreground leading-7">
          The list omits <code className="font-mono text-sm">lookups</code>,
          which would multiply a page by roughly four. Fetch a single domain to
          get them. At the maximum{" "}
          <code className="font-mono text-sm">limit</code> of 200, reconciling
          ten thousand domains is fifty requests — well inside the rate limit.
        </p>
      </Section>

      <Section id="derivation" title="Why we said that">
        <p className="mb-4 text-muted-foreground leading-7">
          Every check carries the lookups that produced it, on the check
          response and on{" "}
          <code className="font-mono text-sm">GET /v1/domains/:id</code>{" "}
          afterwards. A verdict you cannot audit is a verdict you have to take
          on faith, and we would rather you did not have to.
        </p>
        <Code>{`"lookups": [
  { "name": "customer.example", "type": 16,
    "purpose": "SPF record", "server": "9.9.9.9:53", "status": "answered" },
  { "name": "pg1._domainkey.customer.example", "type": 16,
    "purpose": "expected selector", "server": "9.9.9.9:53", "status": "nxdomain" }
]`}</Code>
        <p className="text-muted-foreground leading-7">
          Which server was asked matters: a lame delegation is a fact about one
          nameserver, not about the zone.
        </p>
      </Section>

      <Section id="verdicts" title="Verdicts">
        <p className="mb-6 text-muted-foreground leading-7">
          Four, not two. The distinction between <em>this is broken</em> and{" "}
          <em>we could not tell</em> is preserved by every layer beneath this
          API, and it is the one thing worth understanding before you build on
          it.
        </p>
        <ul>
          {Object.entries(VERDICTS).map(([verdict, meaning]) => (
            <li
              className="border-white/5 border-b py-4 last:border-0"
              key={verdict}
            >
              <div className="mb-1 flex items-baseline gap-3">
                <code className="font-mono text-sm">{verdict}</code>
                <span className="text-muted-foreground text-xs">
                  satisfied: {meaning.satisfied}
                </span>
              </div>
              <p className="mb-1 text-muted-foreground text-sm leading-6">
                {meaning.summary}
              </p>
              <p className="text-muted-foreground text-sm leading-6">
                {meaning.effect}
              </p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="state" title="Domain state">
        <Code>{`                    check passes / warns
  pending ─────────────────────────────────▶ verified
     │                                           │
     │ check fails                   check fails │
     ▼                                           ▼
  failed  ◀──────────────────────────────────  failed

  indeterminate ── no transition. The domain keeps the state it had.`}</Code>
        <p className="mb-4 text-muted-foreground leading-7">
          A check that could not complete says nothing about the domain, so
          nothing moves.{" "}
          <code className="font-mono text-sm">lastCheckedAt</code> advances, the
          result records the uncertainty, and the timeline stays silent.
        </p>
        <p className="text-muted-foreground leading-7">
          Two further states —{" "}
          <code className="font-mono text-sm">verifying</code> and{" "}
          <code className="font-mono text-sm">degraded</code> — exist in the
          schema and are not reachable yet. They arrive with continuous
          monitoring. Treat the state as an open set.
        </p>
      </Section>

      <Section id="timeline" title="Timeline">
        <Code>{`GET /v1/domains/:id/timeline?limit=50

{
  "data": [
    { "object": "record_change", "requirementKey": "dkim",
      "previous": "pass", "current": "fail:DKIM_RECORD_MISSING",
      "observedAt": "2026-08-01T14:02:11.000Z" }
  ]
}`}</Code>
        <p className="mb-4 text-muted-foreground leading-7">
          Newest first. An entry is appended <em>only</em> when an observation
          actually differs from the last one — a check that sees the same thing
          writes nothing at all.
        </p>
        <p className="text-muted-foreground leading-7">
          What is compared is the requirement&apos;s observed state, not the raw
          record text. A requirement is satisfied by a property of the zone, and
          several different records satisfy it identically; comparing text would
          produce an entry every time a customer reordered their SPF mechanisms.
        </p>
      </Section>

      <Section id="limits" title="Rate limits">
        <p className="mb-4 text-muted-foreground leading-7">
          Per account, and sized as tripwires rather than quotas:{" "}
          <strong>250 requests a second</strong> overall, and{" "}
          <strong>100 verifications a minute</strong>. A{" "}
          <code className="font-mono text-sm">429</code> names the limit it
          enforced and carries a{" "}
          <code className="font-mono text-sm">Retry-After</code>.
        </p>
        <p className="mb-4 text-muted-foreground leading-7">
          The request limit is a one-second window rather than the same average
          over a minute, because a minute-long window permits the whole
          allowance as a single burst — which is the shape that actually hurts a
          connection pool.
        </p>
        <p className="mb-4 text-muted-foreground leading-7">
          The verification limit is the one worth planning around. A check costs
          up to twenty upstream queries aimed at whichever authoritative servers
          you name, so it is sized against other people&apos;s infrastructure
          rather than ours. Continuous re-checking is the sweeper&apos;s job and
          does not come through this endpoint or count against this limit.
        </p>
        <p className="text-muted-foreground leading-7">
          If a real integration reaches either of these, the number is wrong and
          we would rather re-measure it than have you work around it. Tell us —
          the request ceiling is a per-account value we can raise.
        </p>
      </Section>
    </>
  );
}
