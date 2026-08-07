/** The webhook family. Output shapes follow `packages/cli/src/commands/webhooks.ts`. */

export const CREATE_CLI = `propgate webhooks create \\
  --url https://example.com/hooks/propgate \\
  --events domain.failed,domain.recovered`;

export const CREATE_OUTPUT = `Created.

  id       019fcf7a-2b3c-7d4e-9f5a-6b7c8d9e0f1a
  url      https://example.com/hooks/propgate
  events   domain.failed, domain.recovered
  state    enabled
  created  2026-08-06 09:12

  signing secret  whsec_7f3a9c2e1b8d4a6f0c5e2b9d7a4f1c8e

Shown once. Rotate with \`propgate webhooks rotate <id>\` if it is lost.`;

export const LIST_CLI = "propgate webhooks list";

export const LIST_OUTPUT = `enabled   https://example.com/hooks/propgate  domain.failed, domain.recovered
disabled  https://staging.example.com/hooks   all events`;

export const UPDATE_CLI = `propgate webhooks update <id> --state disabled
propgate webhooks update <id> --state enabled
propgate webhooks update <id> --events domain.verified`;

export const ROTATE_CLI = "propgate webhooks rotate <id> --window-hours 24";

export const ROTATE_OUTPUT = `whsec_2d8f1a4c9e3b7f0a6c2e8d5b1f9a3c7e

Shown once. The previous secret keeps verifying until 2026-08-07 09:12, so deploy this one before then.`;

export const DELIVERIES_CLI = `propgate webhooks deliveries <id> --status failed
propgate webhooks deliveries <id> --all --json`;

export const DELIVERIES_OUTPUT = `failed     domain.failed     2026-08-06 09:14  3 attempts  502 from endpoint
delivered  domain.degraded   2026-08-06 08:41  1 attempt
delivered  domain.verified   2026-08-05 17:02  1 attempt`;
