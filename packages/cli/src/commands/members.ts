import { apiRequest } from "../client";
import type { Command } from "../command";
import { json, out, reportApiError } from "../output";
import { table, when } from "../table";

/**
 * `GET /v1/members`.
 *
 * One command, and there will not be more. Membership is granted by proving
 * control of a mailbox through signup, so there is nothing here to create or
 * delete — a `members add` would be a way to add someone who never proved
 * anything.
 */

interface MemberRow {
  readonly createdAt: string;
  readonly email: string;
  readonly id: string;
}

export const membersCommand: Command = {
  authenticated: true,
  fields: [],
  networked: true,
  path: ["members", "list"],
  run: async (_input, context) => {
    const result = await apiRequest<MemberRow[]>({
      apiKey: context.apiKey,
      apiUrl: context.apiUrl,
      path: "/v1/members",
    });

    if (!result.ok || result.body.data === null) {
      return reportApiError(
        result.status,
        result.body.error?.message,
        "could not list members"
      );
    }

    if (context.json) {
      return json(result.body);
    }

    for (const line of table(
      result.body.data.map((member) => [
        member.email,
        `joined ${when(member.createdAt)}`,
      ])
    )) {
      out(line);
    }

    return 0;
  },
  summary: "Who is on this account. Read-only.",
};
