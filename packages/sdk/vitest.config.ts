import { defineConfig } from "vitest/config";

/**
 * One project, and deliberately no fixture-backed one.
 *
 * Everything here is HTTP against the propgate API, so the specs stub `fetch`
 * and assert what went over the wire. That is not the mocking invariant 1 bans —
 * nothing here resolves DNS, and the thing being tested is request construction
 * and response handling.
 *
 * What a stubbed `fetch` cannot catch is the API answering in a shape this
 * package reads differently than the server writes it. That is covered by
 * `apps/api/src/e2e/sdk.e2e.spec.ts`, which drives this client against a real
 * `createApp()` over a socket, and by `apps/api/src/sdk-coverage.spec.ts`, which
 * fails when a route exists that no method here reaches.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts"],
    name: "sdk",
  },
});
