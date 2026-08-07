/**
 * Columns that line up, without a table library.
 *
 * Every list command was doing its own `padEnd` against a width someone guessed,
 * which is fine until a domain name is longer than the guess and the column after
 * it walks off. Measuring the rows first costs one pass and removes the guess.
 */

const GAP = "  ";

/**
 * Pad every column to its widest cell.
 *
 * The last column is never padded — trailing spaces are invisible until someone
 * pipes the output somewhere that shows them.
 */
export function table(rows: readonly (readonly string[])[]): string[] {
  if (rows.length === 0) {
    return [];
  }

  const columns = Math.max(...rows.map((row) => row.length));
  const widths: number[] = [];

  for (let index = 0; index < columns; index += 1) {
    widths.push(Math.max(...rows.map((row) => (row[index] ?? "").length), 0));
  }

  return rows.map((row) =>
    row
      .map((cell, index) =>
        index === row.length - 1 ? cell : cell.padEnd(widths[index] ?? 0)
      )
      .join(GAP)
      .trimEnd()
  );
}

/** An ISO timestamp as something a person reads, or `never`. */
export function when(value: string | null | undefined): string {
  return value === null || value === undefined
    ? "never"
    : value.slice(0, 16).replace("T", " ");
}
