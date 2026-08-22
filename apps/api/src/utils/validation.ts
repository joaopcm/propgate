import type { z } from "zod";

export function firstIssue(error: z.ZodError): string {
  const issue = error.issues.at(0);

  if (issue === undefined) {
    return "invalid request";
  }

  const path = issue.path.reduce<string>((rendered, segment) => {
    if (typeof segment === "number") {
      return `${rendered}[${segment}]`;
    }

    return rendered === "" ? String(segment) : `${rendered}.${String(segment)}`;
  }, "");

  return path === "" ? issue.message : `${path}: ${issue.message}`;
}
