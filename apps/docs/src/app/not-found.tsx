import Link from "next/link";
import { notFoundMarkdown } from "@/lib/not-found-markdown";

/**
 * Real HTTP 404 page.
 *
 * Cloudflare `not_found_handling: "404-page"` serves this file as 404.html
 * with status 404. The visible markdown is the same recovery body the Worker
 * returns for `Accept: text/markdown`, so an agent that landed on HTML still
 * gets sitemap / llms.txt / OpenAPI pointers it can follow.
 */

export default function NotFound() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16">
      <p className="font-semibold text-sm tracking-tight">
        propgate <span className="text-muted-foreground">docs</span>
      </p>
      <h1 className="mt-8 font-semibold text-3xl tracking-tight">
        Page not found
      </h1>
      <p className="mt-4 text-muted-foreground text-sm leading-7">
        This path does not exist. Try the{" "}
        <Link className="text-foreground underline underline-offset-4" href="/">
          docs index
        </Link>
        , the{" "}
        <Link
          className="text-foreground underline underline-offset-4"
          href="/developers"
        >
          developer portal
        </Link>
        , or{" "}
        <Link
          className="text-foreground underline underline-offset-4"
          href="/llms.txt"
        >
          llms.txt
        </Link>
        .
      </p>
      <pre className="mt-10 overflow-x-auto bg-muted p-4 font-mono text-muted-foreground text-xs leading-6">
        {notFoundMarkdown()}
      </pre>
    </main>
  );
}
