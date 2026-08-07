"use client";

import { useRouter } from "next/navigation";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHotkeys } from "react-hotkeys-hook";
import { cn } from "@/lib/cn";
import {
  moveActive,
  type SearchRecord,
  type SearchResult,
  search,
  tokenize,
} from "@/lib/search";

/**
 * Search over the whole site, in the browser.
 *
 * The index is one static asset built at `next build`, fetched the first time
 * somebody focuses the box and then held for the visit. Nothing is fetched on
 * page load: a reader who never searches never pays for this.
 *
 * `useHotkeys` leaves form tags alone by default, which is the behaviour wanted
 * here without asking for it — `/` from anywhere on the page focuses the box,
 * and `/` once the box has focus types a slash.
 */

const REGEXP_SPECIAL = /[.*+?^${}()|[\]\\]/g;

let indexPromise: Promise<SearchRecord[]> | undefined;

/**
 * Fetch once per visit.
 *
 * The promise is the cache, so two focus events in the same tick share one
 * request. A failure clears it rather than poisoning the module: the next focus
 * is allowed to try again, and until then the menu behaves like a search that
 * found nothing rather than like a page that broke.
 */
function loadIndex(): Promise<SearchRecord[]> {
  indexPromise ??= fetch("/search-index.json")
    .then((response) => response.json() as Promise<SearchRecord[]>)
    .catch(() => {
      indexPromise = undefined;

      return [];
    });

  return indexPromise;
}

interface Part {
  readonly key: string;
  readonly match: boolean;
  readonly text: string;
}

function splitOnTokens(text: string, tokens: readonly string[]): Part[] {
  if (tokens.length === 0) {
    return [{ key: "0", match: false, text }];
  }

  const escaped = tokens.map((token) => token.replace(REGEXP_SPECIAL, "\\$&"));
  const matched = new Set(tokens);
  const parts: Part[] = [];
  let offset = 0;

  for (const piece of text.split(new RegExp(`(${escaped.join("|")})`, "i"))) {
    if (piece !== "") {
      parts.push({
        key: String(offset),
        match: matched.has(piece.toLowerCase()),
        text: piece,
      });
    }

    offset += piece.length;
  }

  return parts;
}

function Snippet({
  text,
  tokens,
}: {
  readonly text: string;
  readonly tokens: readonly string[];
}) {
  return (
    <p className="mt-0.5 text-muted-foreground text-xs leading-5">
      {splitOnTokens(text, tokens).map((part) =>
        part.match ? (
          <strong className="font-medium text-foreground" key={part.key}>
            {part.text}
          </strong>
        ) : (
          part.text
        )
      )}
    </p>
  );
}

function trail(result: SearchResult): string {
  return [result.section, result.group, result.heading]
    .filter((part) => part !== undefined)
    .join(" › ");
}

/**
 * A `button` rather than a bare `li[role=option]`.
 *
 * The listbox pattern moves selection with `aria-activedescendant` and never
 * moves focus, so these are taken out of the tab order — but they are still
 * clickable things, and making them buttons is what stops the row needing a
 * hand-rolled keyboard handler to be reachable at all.
 */
function Option({
  active,
  id,
  onHover,
  onSelect,
  position,
  result,
  tokens,
}: {
  readonly active: boolean;
  readonly id: string;
  readonly onHover: (position: number) => void;
  readonly onSelect: (result: SearchResult) => void;
  readonly position: number;
  readonly result: SearchResult;
  readonly tokens: readonly string[];
}) {
  const select = useCallback(() => onSelect(result), [onSelect, result]);
  const hover = useCallback(() => onHover(position), [onHover, position]);

  return (
    <button
      aria-selected={active}
      className={cn(
        "block w-full border-border border-b px-3 py-2 text-left last:border-0",
        active && "bg-muted"
      )}
      id={id}
      onClick={select}
      onMouseEnter={hover}
      role="option"
      tabIndex={-1}
      type="button"
    >
      <span className="block text-[0.625rem] text-muted-foreground uppercase tracking-widest">
        {trail(result)}
      </span>
      <span className="mt-0.5 block font-medium text-foreground text-sm">
        {result.title}
      </span>
      <Snippet text={result.snippet} tokens={tokens} />
    </button>
  );
}

export function DocsSearch() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();

  const [index, setIndex] = useState<readonly SearchRecord[]>([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => search(index, query), [index, query]);
  const tokens = useMemo(() => tokenize(query), [query]);
  const showMenu = open && query.trim() !== "";

  /**
   * `useKey: true` is load-bearing, not a preference.
   *
   * Without it `react-hotkeys-hook` matches on `event.code`, which for this key
   * is `Slash` — never equal to the hotkey `"/"`, so the binding silently never
   * fires. It is also the right semantics: the reader is asking for the
   * character they typed, and on a German layout `/` is Shift+7 on a physical
   * key whose `code` is `Digit7`. Matching the character works everywhere;
   * matching the position works on US layouts and nowhere else.
   */
  useHotkeys(
    "/",
    () => {
      inputRef.current?.focus();
    },
    { preventDefault: true, useKey: true }
  );

  const go = useCallback(
    (result: SearchResult) => {
      router.push(result.href);
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    },
    [router]
  );

  const onChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(event.target.value);
    setActive(0);
    setOpen(true);
  }, []);

  const onFocus = useCallback(() => {
    loadIndex().then(setIndex);
  }, []);

  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        inputRef.current?.blur();
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
        setActive((current) => moveActive(current, 1, results.length));
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((current) => moveActive(current, -1, results.length));
        return;
      }

      if (event.key === "Enter") {
        const result = results[active];

        if (result !== undefined) {
          event.preventDefault();
          go(result);
        }
      }
    },
    [active, go, results]
  );

  useEffect(() => {
    if (!showMenu) {
      return;
    }

    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);

    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showMenu]);

  // Keeps the highlighted row visible once the list is longer than the panel.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="relative hidden sm:block" ref={containerRef}>
      <div className="flex h-7 items-center gap-2 border border-border bg-muted/40 px-2 transition-colors focus-within:border-rule">
        <input
          aria-activedescendant={
            showMenu && results.length > 0 ? `${listId}-${active}` : undefined
          }
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={showMenu}
          aria-label="Search the documentation"
          autoComplete="off"
          className="w-36 bg-transparent text-xs outline-none placeholder:text-muted-foreground lg:w-52"
          onChange={onChange}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          placeholder="Search"
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          type="search"
          value={query}
        />
        {query === "" ? (
          <kbd className="border border-border px-1 font-mono text-[0.625rem] text-muted-foreground">
            /
          </kbd>
        ) : null}
      </div>

      {showMenu ? (
        <div className="absolute top-9 right-0 z-30 max-h-[70vh] w-[24rem] overflow-y-auto border border-border bg-background">
          {results.length === 0 ? (
            <p className="px-3 py-3 text-muted-foreground text-xs">
              No results for “{query.trim()}”.
            </p>
          ) : (
            <div id={listId} ref={listRef} role="listbox">
              {results.map((result, position) => (
                <Option
                  active={position === active}
                  id={`${listId}-${position}`}
                  key={result.href}
                  onHover={setActive}
                  onSelect={go}
                  position={position}
                  result={result}
                  tokens={tokens}
                />
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
