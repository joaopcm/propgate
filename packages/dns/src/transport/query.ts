import { randomInt } from "node:crypto";
import { createSocket } from "node:dgram";
import { connect } from "node:net";
import { resolvePort, type ServerAddress } from "../types";
import { decodeMessage, encodeQuery, type Message } from "../wire/message";
import type { QueryOutcome, QuerySpec } from "./types";

/**
 * UDP and TCP transports.
 *
 * Deliberately built on node:dgram and node:net rather than node:dns. c-ares
 * cannot expose the TC bit, set DO, return RRSIGs, read the authority-section
 * SOA of an NXDOMAIN, or control the advertised EDNS buffer size — and each of
 * those is load-bearing for a diagnosis code. See README.md for the full table.
 */

const DEFAULT_TIMEOUT_MS = 5000;
/** RFC 1035 §4.2.2: TCP messages carry a 2-byte big-endian length prefix. */
const TCP_LENGTH_PREFIX_BYTES = 2;
const MAX_MESSAGE_ID = 0x1_00_00;

/**
 * Random message ID, checked against the response.
 *
 * The socket is connected, so the kernel already drops datagrams from other
 * peers; the ID check catches a stale reply on a reused ephemeral port. Using
 * node:crypto rather than Math.random costs nothing here (one call per query)
 * and removes the "is this good enough?" question from a security-adjacent
 * decision entirely.
 */
function nextId(): number {
  return randomInt(MAX_MESSAGE_ID);
}

function elapsedSince(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1_000_000;
}

function errorCodeOf(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    return String((error as { code: unknown }).code);
  }

  return "UNKNOWN";
}

interface RawExchange {
  readonly buffer: Buffer;
  readonly kind: "response";
}

type RawOutcome =
  | RawExchange
  | { readonly kind: "timeout" }
  | { readonly kind: "error"; readonly code: string; readonly detail: string };

function sendUdp(
  target: ServerAddress,
  payload: Buffer,
  timeoutMs: number
): Promise<RawOutcome> {
  return new Promise((resolve) => {
    const socket = createSocket("udp4");
    let settled = false;

    const finish = (outcome: RawOutcome) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.close();
      resolve(outcome);
    };

    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);

    socket.on("message", (buffer) => finish({ buffer, kind: "response" }));
    socket.on("error", (error) =>
      finish({
        code: errorCodeOf(error),
        detail: error.message,
        kind: "error",
      })
    );

    // Connecting the socket is what turns "port closed" into an ECONNREFUSED
    // we can report, instead of a silent timeout.
    socket.connect(resolvePort(target), target.address, () => {
      socket.send(payload, (error) => {
        if (error) {
          finish({
            code: errorCodeOf(error),
            detail: error.message,
            kind: "error",
          });
        }
      });
    });
  });
}

function sendTcp(
  target: ServerAddress,
  payload: Buffer,
  timeoutMs: number
): Promise<RawOutcome> {
  return new Promise((resolve) => {
    const framed = Buffer.allocUnsafe(TCP_LENGTH_PREFIX_BYTES + payload.length);
    framed.writeUInt16BE(payload.length, 0);
    payload.copy(framed, TCP_LENGTH_PREFIX_BYTES);

    const socket = connect({
      host: target.address,
      port: resolvePort(target),
    });

    let settled = false;
    let received = Buffer.alloc(0);
    let expected: number | undefined;

    const finish = (outcome: RawOutcome) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      socket.destroy();
      resolve(outcome);
    };

    const timer = setTimeout(() => finish({ kind: "timeout" }), timeoutMs);

    socket.on("connect", () => socket.write(framed));

    socket.on("data", (chunk) => {
      received = Buffer.concat([received, chunk]);

      if (
        expected === undefined &&
        received.length >= TCP_LENGTH_PREFIX_BYTES
      ) {
        expected = received.readUInt16BE(0);
      }

      if (
        expected !== undefined &&
        received.length >= TCP_LENGTH_PREFIX_BYTES + expected
      ) {
        finish({
          buffer: received.subarray(
            TCP_LENGTH_PREFIX_BYTES,
            TCP_LENGTH_PREFIX_BYTES + expected
          ),
          kind: "response",
        });
      }
    });

    socket.on("error", (error) =>
      finish({
        code: errorCodeOf(error),
        detail: error.message,
        kind: "error",
      })
    );

    // A close before the full message arrived is its own failure: reporting it
    // as a timeout would hide a server that hung up mid-answer.
    socket.on("close", () =>
      finish({
        code: "ECONNCLOSED",
        detail: "connection closed before a complete response arrived",
        kind: "error",
      })
    );
  });
}

type Interpreted =
  | { readonly kind: "outcome"; readonly outcome: QueryOutcome }
  | { readonly kind: "message"; readonly message: Message };

function interpret(
  raw: RawOutcome,
  transport: "udp" | "tcp",
  timeoutMs: number,
  start: bigint,
  expectedId: number
): Interpreted {
  if (raw.kind === "timeout") {
    return {
      kind: "outcome",
      outcome: {
        elapsedMs: elapsedSince(start),
        status: "timeout",
        timeoutMs,
        transport,
      },
    };
  }

  if (raw.kind === "error") {
    return {
      kind: "outcome",
      outcome: {
        code: raw.code,
        detail: raw.detail,
        elapsedMs: elapsedSince(start),
        status: "unreachable",
        transport,
      },
    };
  }

  const decoded = decodeMessage(raw.buffer);

  if (!decoded.ok) {
    return {
      kind: "outcome",
      outcome: {
        detail: decoded.message,
        elapsedMs: elapsedSince(start),
        offset: decoded.offset,
        reason: decoded.reason,
        status: "malformed",
        transport,
      },
    };
  }

  if (decoded.value.id !== expectedId) {
    return {
      kind: "outcome",
      outcome: {
        detail: `expected id ${expectedId}, got ${decoded.value.id}`,
        elapsedMs: elapsedSince(start),
        offset: 0,
        reason: "id-mismatch",
        status: "malformed",
        transport,
      },
    };
  }

  return { kind: "message", message: decoded.value };
}

/**
 * Send one query and return what happened.
 *
 * On a truncated UDP answer the query is retried over TCP by default, because
 * that is what a resolver must do for a 4096-bit DKIM key. Pass
 * `retryOverTcp: false` to observe the TC bit instead — which is how the
 * truncation fixtures assert both sides of the 512-byte boundary.
 */
export async function query(spec: QuerySpec): Promise<QueryOutcome> {
  const timeoutMs = spec.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const id = nextId();
  const encoded = encodeQuery({
    checkingDisabled: spec.checkingDisabled,
    dnssecOk: spec.dnssecOk,
    ednsBufferSize: spec.ednsBufferSize,
    id,
    name: spec.name,
    recursionDesired: spec.recursionDesired,
    type: spec.type,
  });

  const wantsTcpFirst = spec.target.transport === "tcp";
  const start = process.hrtime.bigint();

  const firstTransport = wantsTcpFirst ? "tcp" : "udp";
  const raw = await (wantsTcpFirst
    ? sendTcp(spec.target, encoded, timeoutMs)
    : sendUdp(spec.target, encoded, timeoutMs));

  const interpreted = interpret(raw, firstTransport, timeoutMs, start, id);

  if (interpreted.kind === "outcome") {
    return interpreted.outcome;
  }

  const { message } = interpreted;

  if (!message.flags.tc || wantsTcpFirst) {
    return {
      elapsedMs: elapsedSince(start),
      message,
      retriedOverTcp: false,
      status: "answered",
      transport: firstTransport,
    };
  }

  if (spec.retryOverTcp === false) {
    return {
      elapsedMs: elapsedSince(start),
      message,
      status: "truncated",
      transport: "udp",
    };
  }

  const retryRaw = await sendTcp(spec.target, encoded, timeoutMs);
  const retry = interpret(retryRaw, "tcp", timeoutMs, start, id);

  if (retry.kind === "outcome") {
    return retry.outcome;
  }

  return {
    elapsedMs: elapsedSince(start),
    message: retry.message,
    retriedOverTcp: true,
    status: "answered",
    transport: "tcp",
  };
}
