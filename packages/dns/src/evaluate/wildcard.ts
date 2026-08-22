import { randomBytes } from "node:crypto";
import { RecordType } from "../wire/constants";
import type { EvaluationContext } from "./context";

function unpublishableLabel(): string {
  return `_pg-probe-${randomBytes(8).toString("hex")}`;
}

export interface WildcardProbe {
  readonly probed: string;
  readonly synthesises: boolean;
}

export async function probeWildcard(
  context: EvaluationContext,
  domain: string
): Promise<WildcardProbe> {
  const probed = `${unpublishableLabel()}.${domain}`;

  const outcome = await context.lookup({
    name: probed,
    purpose: "probing a name nobody published, to detect wildcard synthesis",
    type: RecordType.TXT,
  });

  if (outcome.status !== "answered") {
    return { probed, synthesises: false };
  }

  return {
    probed,
    synthesises: outcome.message.answers.length > 0,
  };
}
