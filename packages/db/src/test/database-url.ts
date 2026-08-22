const LEADING_SLASH = /^\//;

export function testDatabaseUrl(suffix: string): string {
  if (
    process.env.PROPGATE_DATABASE_BASE_URL === undefined &&
    process.env.DATABASE_URL !== undefined
  ) {
    process.env.PROPGATE_DATABASE_BASE_URL = process.env.DATABASE_URL;
  }

  const base = process.env.PROPGATE_DATABASE_BASE_URL;

  if (base === undefined || base === "") {
    return "";
  }

  const url = new URL(base);

  url.pathname = `/${url.pathname.replace(LEADING_SLASH, "")}_${suffix}`;

  return url.toString();
}
