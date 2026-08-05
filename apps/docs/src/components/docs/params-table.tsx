export interface ParamRow {
  readonly description: string;
  readonly name: string;
  readonly required?: boolean;
  readonly type: string;
}

export function ParamsTable({ rows }: { rows: readonly ParamRow[] }) {
  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead className="border-border border-b">
          <tr>
            <th className="px-3 py-2 text-left font-medium text-foreground text-xs uppercase tracking-wider">
              Field
            </th>
            <th className="px-3 py-2 text-left font-medium text-foreground text-xs uppercase tracking-wider">
              Type
            </th>
            <th className="px-3 py-2 text-left font-medium text-foreground text-xs uppercase tracking-wider">
              Description
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.name}>
              <td className="px-3 py-2 font-mono text-foreground text-xs">
                {row.name}
                {row.required ? (
                  <span className="ml-1 text-[var(--color-destructive)]">
                    *
                  </span>
                ) : null}
              </td>
              <td className="px-3 py-2 text-muted-foreground text-xs">
                {row.type}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.description}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
