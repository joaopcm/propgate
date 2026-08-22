export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;

  if (url === undefined || url === "") {
    throw new Error(
      "DATABASE_URL is required. Set it in the environment of whichever container is running this command."
    );
  }

  return url;
}
