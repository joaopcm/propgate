export interface CheckDomainPayload {
  readonly domainId: string;
  readonly tenantId: string;
}

export interface DeliverWebhookPayload {
  readonly deliveryId: string;
  readonly tenantId: string;
}

export interface SweepTickPayload {
  readonly reason: "reconcile" | "reconcile-deliveries" | "tick";
}
