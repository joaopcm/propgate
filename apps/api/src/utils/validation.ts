import type { z } from "zod";

/**
 * A schema failure, phrased so the reader can act on it.
 *
 * Zod's own message says what was wrong but never *where*: a request body with
 * a missing field comes back as "Invalid input: expected string, received
 * undefined", which is true of a great many bodies and tells an integrator
 * nothing. Prefixing the path turns it into `domain: expected string, received
 * undefined`, and for a nested case `requirements[0].check: ...`.
 *
 * That matters more here than in most APIs. Errors are read by the agent
 * writing the integration as often as by a person, and an agent can fix a named
 * field where it can only guess at a named type.
 *
 * Only the first issue is reported. A caller fixes one thing and asks again,
 * and a list of eight complaints about a body they got fundamentally wrong is
 * noise rather than help.
 */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues.at(0);

  if (issue === undefined) {
    return "invalid request";
  }

  const path = issue.path.reduce<string>((rendered, segment) => {
    // Array indices read as `[0]`, keys as `.key`, so the result is a path a
    // reader can find in the JSON they sent.
    if (typeof segment === "number") {
      return `${rendered}[${segment}]`;
    }

    return rendered === "" ? String(segment) : `${rendered}.${String(segment)}`;
  }, "");

  return path === "" ? issue.message : `${path}: ${issue.message}`;
}
