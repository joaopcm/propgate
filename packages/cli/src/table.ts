const GAP = "  ";

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

export function when(value: string | null | undefined): string {
  return value === null || value === undefined
    ? "never"
    : value.slice(0, 16).replace("T", " ");
}
