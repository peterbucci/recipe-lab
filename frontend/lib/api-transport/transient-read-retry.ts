import { isAbortError } from "../abort-error";

const TRANSIENT_HTTP_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_ERROR_CODES = new Set([
  "network_error",
  "request_timed_out",
]);
const NETWORK_TYPE_ERROR_MESSAGES = [
  "failed to fetch",
  "fetch failed",
  "load failed",
  "networkerror",
];

export const TRANSIENT_READ_RETRY_DELAY_MS = 150;

interface RetryableErrorShape {
  code?: unknown;
  reason?: unknown;
  status?: unknown;
}

export interface TransientReadRetryOptions {
  signal?: AbortSignal;
}

function isErrorShape(value: unknown): value is RetryableErrorShape {
  return typeof value === "object" && value !== null;
}

function isInvalidResponseCode(code: unknown): boolean {
  return (
    typeof code === "string" &&
    (code === "invalid_api_response" ||
      (code.startsWith("invalid_") && code.endsWith("_response")))
  );
}

/**
 * Identifies failures for which repeating an idempotent read is safe and useful.
 * Deliberately excludes aborts, client errors, rate limits, and malformed success
 * payloads even when an API wrapper represents the latter with status 502.
 */
export function isTransientReadFailure(error: unknown): boolean {
  if (isAbortError(error)) return false;

  if (error instanceof DOMException) {
    return error.name === "TimeoutError" || error.name === "NetworkError";
  }

  if (error instanceof TypeError) {
    const message = error.message.toLowerCase();
    return NETWORK_TYPE_ERROR_MESSAGES.some((fragment) =>
      message.includes(fragment),
    );
  }

  if (!isErrorShape(error)) return false;
  if (error.reason === "aborted" || error.reason === "not_sent") return false;
  if (error.reason === "network" || error.reason === "timeout") return true;
  if (TRANSIENT_ERROR_CODES.has(String(error.code))) return true;
  if (isInvalidResponseCode(error.code)) return false;

  return (
    typeof error.status === "number" &&
    TRANSIENT_HTTP_STATUSES.has(error.status)
  );
}

function abortReason(signal: AbortSignal): unknown {
  return (
    signal.reason ??
    new DOMException("The request was aborted.", "AbortError")
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

function retryDelay(signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal);

  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener("abort", abort);
      resolve();
    };
    const abort = () => {
      globalThis.clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      reject(
        signal
          ? abortReason(signal)
          : new DOMException("The request was aborted.", "AbortError"),
      );
    };
    const timeout = globalThis.setTimeout(
      finish,
      TRANSIENT_READ_RETRY_DELAY_MS,
    );
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}

async function runRead<T>(
  read: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  throwIfAborted(signal);
  const result = await read(signal);
  throwIfAborted(signal);
  return result;
}

/**
 * Runs an idempotent read and retries it once after a short delay when the first
 * failure is transient. Mutations must never be passed to this helper.
 */
export async function retryTransientRead<T>(
  read: (signal?: AbortSignal) => Promise<T>,
  { signal }: TransientReadRetryOptions = {},
): Promise<T> {
  try {
    return await runRead(read, signal);
  } catch (error) {
    if (signal?.aborted) throw abortReason(signal);
    if (!isTransientReadFailure(error)) throw error;
  }

  await retryDelay(signal);
  return runRead(read, signal);
}
