const DEFAULT_URL = "redis://127.0.0.1:6389";

let counter = 0;

export function testRedisUrl(): string {
  const url = process.env.REDIS_URL;

  return url === undefined || url === "" ? DEFAULT_URL : url;
}

export function testPrefix(label: string): string {
  counter += 1;

  return `propgate-test-${label}-${process.pid}-${counter}`;
}
