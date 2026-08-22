import {
  assertFixturesFresh,
  assertFixturesReady,
} from "@propgate/dns-fixtures";

export default async function setup(): Promise<void> {
  await assertFixturesReady();
  await assertFixturesFresh();
}
