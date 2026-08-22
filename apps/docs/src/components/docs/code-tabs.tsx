import {
  CodeTabsClient,
  type RenderedTab,
} from "@/components/docs/code-tabs-client";
import { highlight } from "@/lib/shiki";

export interface CodeTabsItem {
  readonly code: string;
  readonly label: string;
  readonly lang: string;
}

export async function CodeTabs({ items }: { items: readonly CodeTabsItem[] }) {
  const rendered: RenderedTab[] = await Promise.all(
    items.map(async (item) => {
      const code = item.code.trim();

      return {
        code,
        html: await highlight(code, item.lang),
        label: item.label,
      };
    })
  );

  return <CodeTabsClient items={rendered} />;
}
