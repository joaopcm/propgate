// biome-ignore-all lint/performance/noBarrelFile: intentional package entry point
export type { Database } from "./client";
export { createDb } from "./client";
export type { Observation } from "./queries/record-changes";
export { recordObservation } from "./queries/record-changes";
