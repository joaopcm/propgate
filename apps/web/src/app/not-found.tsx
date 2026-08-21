import { SiteFooter } from "@/components/site-frame";
import { NOT_FOUND_MARKDOWN } from "@/lib/site";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-20 sm:py-28">
      <p className="font-mono text-muted-foreground/60 text-xs uppercase tracking-[0.2em]">
        propgate / 404
      </p>
      <h1 className="mt-4 font-semibold text-3xl tracking-tight">Not found</h1>
      <p className="mt-8 text-muted-foreground text-sm leading-relaxed">
        This path does not exist on propgate.dev. The sitemap, agent index, and
        API spec are the places to look next.
      </p>
      <pre className="mt-8 overflow-x-auto whitespace-pre-wrap font-mono text-muted-foreground/80 text-xs leading-relaxed">
        {NOT_FOUND_MARKDOWN}
      </pre>
      <SiteFooter />
    </main>
  );
}
