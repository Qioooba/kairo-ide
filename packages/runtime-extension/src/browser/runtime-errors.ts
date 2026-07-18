/**
 * Kairo runtime client error handling.
 *
 * The Theia side never talks to /api/v1 directly. It goes through
 * `KairoRuntimeImpl.request(endpoint, payload, init)`. All errors
 * raised by that path are normalised into `KairoError` instances
 * so the UI can show meaningful messages instead of `[object Object]`.
 *
 * Categories of failure the client must recognise:
 *
 *   1. The server returned a non-2xx status (HTTP error).
 *   2. The server returned 2xx with `ok: false` (protocol error).
 *   3. The server returned 2xx with a payload that doesn't match
 *      `ResponseEnvelope` (malformed response).
 *   4. The client could not reach the server (network / DNS / TCP).
 *   5. The client aborted the request via `AbortSignal`.
 *   6. The response JSON could not be parsed.
 *
 * Each `KairoError` carries a stable `code` and a `retryable`
 * flag so views can decide whether to show a retry button.
 */

import type { KairoError as ProtocolError, KairoErrorCode, ResponseEnvelope, ErrorEnvelope } from '@kairo/protocol';

/**
 * Default fallback code when the server gave us something we
 * can't recognise. We surface this as a stable code so the UI
 * can map it to a clear message ("The runtime agent answered,
 * but its response was unparseable").
 */
export const FALLBACK_ERROR_CODE: KairoErrorCode = 'internal';

export class KairoError extends Error {
  readonly code: KairoErrorCode;
  readonly httpStatus?: number;
  readonly details?: unknown;
  readonly retryable: boolean;
  /** ISO-8601 timestamp the client first observed the failure. */
  readonly observedAt: string;

  constructor(init: {
    code: KairoErrorCode;
    message: string;
    httpStatus?: number;
    details?: unknown;
    retryable?: boolean;
    cause?: unknown;
  }) {
    super(init.message, { cause: init.cause });
    this.name = 'KairoError';
    this.code = init.code;
    this.httpStatus = init.httpStatus;
    this.details = init.details;
    this.retryable = init.retryable ?? false;
    this.observedAt = new Date().toISOString();
  }

  /**
   * True when the failure looks transient and the caller can
   * try again without changing the request payload.
   */
  isTransient(): boolean {
    if (this.retryable) return true;
    if (this.code === 'timeout') return true;
    if (this.code === 'io_error') return true;
    if (this.code === 'process_spawn_failed') return true;
    if (this.httpStatus !== undefined && this.httpStatus >= 500) return true;
    return false;
  }

  /**
   * Return a string suitable for showing in the UI. Includes the
   * stable code, the human message, and (when present) the
   * underlying cause.
   */
  format(): string {
    const head = `[${this.code}] ${this.message}`;
    if (this.httpStatus !== undefined) {
      return `${head} (HTTP ${this.httpStatus})`;
    }
    if (this.cause instanceof Error) {
      return `${head}: ${this.cause.message}`;
    }
    return head;
  }
}

/**
 * Map a non-2xx HTTP status into a KairoErrorCode.
 */
function httpStatusToCode(status: number): KairoErrorCode {
  if (status === 401) return 'unauthenticated';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 429) return 'rate_limited';
  if (status >= 400 && status < 500) return 'invalid_request';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'internal';
  return FALLBACK_ERROR_CODE;
}

function isProtocolError(x: unknown): x is ProtocolError {
  return !!x && typeof x === 'object' && typeof (x as ProtocolError).code === 'string' && typeof (x as ProtocolError).message === 'string';
}

function isErrorEnvelope(x: unknown): x is ErrorEnvelope {
  return !!x && typeof x === 'object' && (x as ErrorEnvelope).ok === false && isProtocolError((x as ErrorEnvelope).error);
}

function isResponseEnvelope(x: unknown): x is ResponseEnvelope {
  return !!x && typeof x === 'object' && (x as ResponseEnvelope).ok === true && 'payload' in (x as ResponseEnvelope);
}

/**
 * Inspect a Response + parsed JSON body and either return the
 * payload or throw a `KairoError` describing the failure.
 *
 * The caller is expected to have read the body already; this
 * function does no I/O.
 */
export function unwrapResponse(res: Response, body: unknown): unknown {
  if (res.status === 204) return undefined;
  if (res.status < 200 || res.status >= 300) {
    if (isErrorEnvelope(body)) {
      const e = body.error;
      throw new KairoError({
        code: e.code,
        message: e.message,
        details: e.details,
        retryable: e.retryable,
        httpStatus: res.status,
      });
    }
    throw new KairoError({
      code: httpStatusToCode(res.status),
      message: `Runtime agent returned HTTP ${res.status} ${res.statusText || ''}`.trim(),
      httpStatus: res.status,
      details: body,
    });
  }
  if (!isResponseEnvelope(body)) {
    throw new KairoError({
      code: FALLBACK_ERROR_CODE,
      message: 'Runtime agent returned a response that did not match the Kairo envelope',
      httpStatus: res.status,
      details: body,
    });
  }
  return body.payload;
}

/**
 * Translate a thrown value (e.g. from fetch) into a `KairoError`.
 * If `err` is already a `KairoError` it is returned unchanged.
 */
export function normaliseThrown(err: unknown, fallbackMessage = 'Runtime client failed'): KairoError {
  if (err instanceof KairoError) return err;
  if (err instanceof DOMException && err.name === 'AbortError') {
    return new KairoError({ code: 'timeout', message: 'Request was aborted', cause: err });
  }
  if (err instanceof TypeError) {
    // fetch() uses TypeError for network errors.
    return new KairoError({ code: 'io_error', message: err.message || 'Network error', retryable: true, cause: err });
  }
  if (err instanceof Error) {
    return new KairoError({ code: FALLBACK_ERROR_CODE, message: err.message || fallbackMessage, cause: err });
  }
  return new KairoError({ code: FALLBACK_ERROR_CODE, message: fallbackMessage, details: err });
}
