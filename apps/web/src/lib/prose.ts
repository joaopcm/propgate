export type ProseBlock =
  | { readonly items: readonly string[]; readonly kind: "ul" }
  | { readonly kind: "p"; readonly text: string };

export function blocksFrom(text: string): readonly ProseBlock[] {
  const blocks: ProseBlock[] = [];

  for (const chunk of text.split("\n\n")) {
    let items: string[] = [];
    let paragraph: string[] = [];

    const flushList = () => {
      if (items.length > 0) {
        blocks.push({ items, kind: "ul" });
        items = [];
      }
    };

    const flushParagraph = () => {
      if (paragraph.length > 0) {
        blocks.push({ kind: "p", text: paragraph.join("\n") });
        paragraph = [];
      }
    };

    for (const line of chunk.split("\n")) {
      if (line.startsWith("- ")) {
        flushParagraph();
        items.push(line.slice(2));
        continue;
      }

      flushList();
      paragraph.push(line);
    }

    flushParagraph();
    flushList();
  }

  return blocks;
}
