/**
 * Decode failures.
 *
 * A malformed response is a *finding*, not an exception — a provider serving
 * garbage is exactly the sort of thing this library exists to report on. So the
 * decoder returns `DecodeResult` and callers switch on it. `WireFormatError` is
 * thrown only inside the decoder and converted at the boundary, which keeps the
 * parsing code readable without leaking throws into the public API.
 */

export type WireFormatReason =
  | "truncated-buffer"
  | "label-too-long"
  | "name-too-long"
  | "compression-forward-pointer"
  | "rdlength-overrun"
  | "rdlength-underrun"
  | "bad-header"
  | "unexpected-end";

export class WireFormatError extends Error {
  readonly reason: WireFormatReason;
  /** Byte offset where decoding gave up, for error messages worth reading. */
  readonly offset: number;

  constructor(reason: WireFormatReason, offset: number, detail?: string) {
    super(
      `DNS wire format error: ${reason} at byte ${offset}${detail ? ` (${detail})` : ""}`
    );
    this.name = "WireFormatError";
    this.reason = reason;
    this.offset = offset;
  }
}

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: WireFormatReason;
      readonly offset: number;
      readonly message: string;
    };

export function decodeFailure<T>(error: WireFormatError): DecodeResult<T> {
  return {
    message: error.message,
    offset: error.offset,
    ok: false,
    reason: error.reason,
  };
}
