"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";
import {
  isGroupedSection,
  type NavItem,
  type NavSection,
  navigation,
} from "@/lib/navigation";

const BADGE_LABELS: Record<NonNullable<NavItem["badge"]>, string> = {
  beta: "Beta",
  new: "New",
};

function sectionHasItems(section: NavSection): boolean {
  return isGroupedSection(section)
    ? section.groups.some((group) => group.items.length > 0)
    : section.items.length > 0;
}

function ItemList({
  items,
  onNavigate,
  pathname,
}: {
  items: readonly NavItem[];
  onNavigate?: () => void;
  pathname: string;
}) {
  return (
    <ul className="flex flex-col">
      {items.map((item) => {
        const isActive = pathname === item.href;

        return (
          <li key={item.href}>
            <Link
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex items-center justify-between gap-2 px-2 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground",
                isActive && "bg-muted font-medium text-foreground"
              )}
              href={item.href}
              onClick={onNavigate}
            >
              <span>{item.title}</span>
              {item.badge ? (
                <span className="font-medium text-[10px] text-muted-foreground/80 uppercase tracking-wider">
                  {BADGE_LABELS[item.badge]}
                </span>
              ) : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function DocsSidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Documentation"
      className="flex flex-col gap-6 px-4 py-6 md:px-6"
    >
      {navigation.filter(sectionHasItems).map((section) => (
        <div className="flex flex-col gap-3" key={section.title}>
          <h2 className="px-2 font-medium text-muted-foreground text-xs uppercase tracking-wider">
            {section.title}
          </h2>
          {isGroupedSection(section) ? (
            <div className="flex flex-col gap-3">
              {section.groups.map((group) => (
                <div className="flex flex-col gap-1" key={group.title}>
                  <h3 className="px-2 font-medium text-[11px] text-foreground/80">
                    {group.title}
                  </h3>
                  <ItemList
                    items={group.items}
                    onNavigate={onNavigate}
                    pathname={pathname}
                  />
                </div>
              ))}
            </div>
          ) : (
            <ItemList
              items={section.items}
              onNavigate={onNavigate}
              pathname={pathname}
            />
          )}
        </div>
      ))}
    </nav>
  );
}
