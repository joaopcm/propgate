const ID = "019fcf9a-3c4d-7e5f-a06b-7c8d9e0f1a2b";

export const WEBHOOKS_CREATE = `const { data, error, meta } = await propgate.webhooks.create({
  url: "https://example.com/hooks/propgate",
  events: ["domain.failed", "domain.recovered"],
});

if (meta?.created) {
  await storeSigningSecret(data.secret);
}`;

export const WEBHOOKS_MANAGE = `const { data } = await propgate.webhooks.list();

await propgate.webhooks.get("${ID}");

await propgate.webhooks.update("${ID}", { disabled: true });

await propgate.webhooks.remove("${ID}");`;

export const WEBHOOKS_ROTATE = `const { data, meta } = await propgate.webhooks.rotateSecret("${ID}", {
  windowHours: 24,
});

meta?.previousSecretExpiresAt;

await propgate.webhooks.rotateSecret("${ID}", { windowHours: 0 });`;

export const WEBHOOKS_DELIVERIES = `const { data, meta } = await propgate.webhooks.listDeliveries("${ID}", {
  status: "failed",
  limit: 200,
});

for (const delivery of data ?? []) {
  console.log(delivery.event, delivery.attempts, delivery.lastError);
}

const all = await propgate.webhooks.listAllDeliveries("${ID}", { status: "failed" });`;

export const WEBHOOKS_VERIFY = `import { TOLERANCE_SECONDS, verifyPayload } from "@propgate/webhooks";
import type { WebhookPayload } from "@propgate/sdk";

export async function handler(request: Request): Promise<Response> {
  const body = await request.text();
  const timestamp = Number(request.headers.get("webhook-timestamp"));

  if (Math.abs(Date.now() / 1000 - timestamp) > TOLERANCE_SECONDS) {
    return new Response("stale", { status: 400 });
  }

  const verified = verifyPayload({
    body,
    header: request.headers.get("webhook-signature") ?? "",
    id: request.headers.get("webhook-id") ?? "",
    secret: process.env.PROPGATE_WEBHOOK_SECRET ?? "",
    timestamp,
  });

  if (!verified) {
    return new Response("bad signature", { status: 400 });
  }

  const payload = JSON.parse(body) as WebhookPayload;

  if (payload.type === "domain.failed") {
    await notify(payload.data.external_id, payload.data.reason);
  }

  return new Response(null, { status: 200 });
}`;
