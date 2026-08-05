import { type FlatNavEntry, flattenNavigation } from "./navigation";

export function pagerFor(href: string): {
  next?: FlatNavEntry;
  previous?: FlatNavEntry;
} {
  const entries = flattenNavigation();
  const index = entries.findIndex((entry) => entry.href === href);

  if (index === -1) {
    return {};
  }

  const previous = entries[index - 1];
  const next = entries[index + 1];

  return {
    ...(next === undefined ? {} : { next }),
    ...(previous === undefined ? {} : { previous }),
  };
}
