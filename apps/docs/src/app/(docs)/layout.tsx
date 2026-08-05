import type { ReactNode } from "react";
import { Breadcrumbs } from "@/components/docs/breadcrumbs";
import { PagerFooter } from "@/components/docs/pager-footer";
import { DocsHeader } from "@/components/docs-header";
import { DocsSidebar } from "@/components/docs-sidebar";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <DocsHeader />
      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 border-border/80 border-r md:block">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-y-auto">
            <DocsSidebar />
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-8 md:px-10 md:py-12">
          <div className="mx-auto max-w-3xl">
            <Breadcrumbs />
            {children}
            <PagerFooter />
          </div>
        </main>
      </div>
    </div>
  );
}
