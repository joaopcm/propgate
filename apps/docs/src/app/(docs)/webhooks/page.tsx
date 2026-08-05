import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  EVENT_NAMES,
  EVENTS,
  TIMESTAMP_TOLERANCE_SECONDS,
} from "@/lib/webhooks";

/**
 * How to receive and verify a webhook.
 *
 * The event table and the tolerance come from `lib/webhooks.ts`, which is keyed
 * by `WebhookEvent` from `@propgate/webhooks` — so an event added to the product
 * without documentation is a `tsc` error, and this page cannot claim a different
 * timestamp tolerance than the signer enforces.
 *
 * The verification snippet below is the same `verifyPayload` shipped in
 * `@propgate/webhooks` and covered by its specs, so the code on this page is
 * tested rather than merely written.
 */

export const metadata: Metadata = {
  description:
    "Receive domain state changes over signed HTTP. Svix-compatible signatures, four events, at-least-once delivery with exponential backoff.",
  title: "Webhooks",
};

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

const VERIFY_SNIPPET = `import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = ${TIMESTAMP_TOLERANCE_SECONDS};

export function verify(rawBody, headers, secret) {
  const id = headers["webhook-id"];
  const timestamp = Number(headers["webhook-timestamp"]);

  // Reject anything too old to be a live delivery. Without this the signature
  // stays valid forever and a captured request can be replayed.
  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) {
    return false;
  }

  // The whsec_ prefix is a label, not key material. Strip it, then base64-decode.
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected =
    "v1," +
    createHmac("sha256", key)
      .update(\`\${id}.\${timestamp}.\${rawBody}\`)
      .digest("base64");

  // The header may carry more than one signature during a secret rotation.
  // Any match is a pass.
  return headers["webhook-signature"]
    .split(" ")
    .some((candidate) => {
      const a = Buffer.from(candidate.trim());
      const b = Buffer.from(expected);

      return a.length === b.length && timingSafeEqual(a, b);
    });
}`;

const PAYLOAD_SNIPPET = `{
  "type": "domain.failed",
  "created_at": "2026-08-03T12:00:00.000Z",
  "data": {
    "id": "019fc8ee-234b-7103-907e-3a9ae3b74d3b",
    "domain": "mail.customer.example",
    "external_id": "cust_1",
    "previous_state": "degraded",
    "state": "failed",
    "reason": "3 consecutive failures, reaching the failed threshold"
  }
}`;

export default function WebhooksPage() {
  return (
    <>
      <h1 className="mb-3 font-semibold text-3xl tracking-tight">Webhooks</h1>
      <p className="mb-12 text-muted-foreground leading-7">
        Domain state changes, delivered over signed HTTP. Manage endpoints under{" "}
        <code className="font-mono text-sm">/v1/webhooks</code> — see the{" "}
        <Link className="underline" href="/api">
          API reference
        </Link>
        .
      </p>

      <Section id="events" title="Events">
        <p className="mb-4 text-muted-foreground leading-7">
          Four events. An endpoint with no <code>events</code> array receives
          all of them.
        </p>
        <ul className="mb-4">
          {EVENT_NAMES.map((event) => (
            <li
              className="border-white/5 border-b py-3 last:border-0"
              key={event}
            >
              <code className="font-mono text-sm">{event}</code>
              <p className="mt-1 text-muted-foreground text-sm leading-6">
                {EVENTS[event].summary}
              </p>
              <p className="mt-1 text-muted-foreground/70 text-sm leading-6">
                Fires {EVENTS[event].fires}.
              </p>
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground leading-7">
          <strong className="text-foreground">
            Do not build a pager on <code>domain.degraded</code>.
          </strong>{" "}
          It means one check failed and we have not confirmed it yet — which is
          often a resolver blip or a zone mid-edit. It fires once per episode
          rather than on every check, so it is safe to display, but{" "}
          <code>domain.failed</code> is the event that means something is really
          wrong.
        </p>
      </Section>

      <Section id="payload" title="Payload">
        <p className="mb-4 text-muted-foreground leading-7">
          Fields are <code>snake_case</code>, unlike the rest of the API,
          because this is the shape most webhook tooling expects.{" "}
          <code>previous_state</code> is what lets you tell a first-time setup
          from a recovery without keeping your own state.
        </p>
        <Code>{PAYLOAD_SNIPPET}</Code>
      </Section>

      <Section id="verifying" title="Verifying a request">
        <p className="mb-4 text-muted-foreground leading-7">
          Three headers: <code>webhook-id</code>, <code>webhook-timestamp</code>{" "}
          (unix seconds) and <code>webhook-signature</code>. The signature is{" "}
          <code>v1,&lt;base64 HMAC-SHA256&gt;</code> over{" "}
          <code>{"{id}.{timestamp}.{body}"}</code>, keyed with your secret. This
          is the Svix format, so an existing Svix verification library works
          unchanged.
        </p>
        <p className="mb-4 text-muted-foreground leading-7">
          Verify against the <em>raw</em> body, before any JSON parsing.
          Re-serialising changes the bytes and the signature will not match.
        </p>
        <Code>{VERIFY_SNIPPET}</Code>
      </Section>

      <Section id="rotation" title="Rotating a secret">
        <p className="mb-4 text-muted-foreground leading-7">
          <code>POST /v1/webhooks/:id/secret</code> returns a new secret and{" "}
          <code>previousSecretExpiresAt</code>. Until that moment every request
          is signed with <strong className="text-foreground">both</strong>{" "}
          secrets, space-separated in the one header — so you can deploy the new
          secret on your own schedule without dropping a delivery. Verify by
          accepting any match, as the snippet above does.
        </p>
        <p className="text-muted-foreground leading-7">
          Rotating because a secret leaked? Pass{" "}
          <code>{'{ "windowHours": 0 }'}</code> and the old one stops being
          accepted immediately.
        </p>
      </Section>

      <Section id="retries" title="Retries and failures">
        <p className="mb-4 text-muted-foreground leading-7">
          Delivery is at-least-once. Return any <code>2xx</code> to acknowledge;
          we do not read the body. Respond quickly and do your work afterwards —
          an attempt that holds the connection open counts against the timeout.
        </p>
        <ul className="mb-4 list-disc pl-5 text-muted-foreground leading-7">
          <li>
            <code>5xx</code>, <code>408</code>, <code>429</code>, a timeout or a
            connection error is retried with exponential backoff from one
            second.
          </li>
          <li>
            Any other <code>4xx</code> is <strong>not</strong> retried. A{" "}
            <code>404</code> means the URL is wrong, and forty more attempts
            will not fix that.
          </li>
          <li>
            Redirects are never followed. A signed request only ever goes to the
            URL you configured.
          </li>
        </ul>
        <p className="text-muted-foreground leading-7">
          Every attempt is recorded.{" "}
          <code>GET /v1/webhooks/:id/deliveries</code> shows the status, the
          attempt count and the last error for each one — which is where to look
          when something did not arrive.
        </p>
      </Section>

      <Section id="ordering" title="Ordering and duplicates">
        <p className="text-muted-foreground leading-7">
          Events are not ordered, and a retry can arrive after a later event.
          Treat <code>data.state</code> as the state at <code>created_at</code>{" "}
          rather than as the current one, and make your handler idempotent on{" "}
          <code>webhook-id</code> — a delivery that succeeded on your side but
          whose response we never saw will be sent again.
        </p>
      </Section>
    </>
  );
}
