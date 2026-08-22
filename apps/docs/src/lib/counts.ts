import { CHECK_KINDS, DIAGNOSIS_REGISTRY } from "@propgate/dns";

export const CHECK_COUNT = CHECK_KINDS.length;

export const DIAGNOSIS_COUNT = Object.keys(DIAGNOSIS_REGISTRY).length;

export const CHECK_LIST = CHECK_KINDS.join(", ");
