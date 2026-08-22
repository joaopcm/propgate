export function markdownPathFor(href: string): string {
  return href === "/" ? "/index.md" : `${href}.md`;
}

export function markdownHrefFromAssetPath(
  pathname: string
): string | undefined {
  if (!pathname.endsWith(".md")) {
    return;
  }

  if (pathname === "/index.md") {
    return "/";
  }

  return pathname.slice(0, -".md".length);
}
