import { retryTransientRead } from "./transient-read-retry";

export type ApiRequestKind = "query" | "mutation";

export type ApiMutationOutcome = "rejected" | "unknown";

export type ApiAuthenticationRecovery =
  | "sign_in"
  | "complete_account_setup"
  | "refresh_session"
  | null;

export type ApiTransportFailureReason =
  | "http"
  | "network"
  | "timeout"
  | "aborted"
  | "invalid_response"
  | "not_sent";

export interface ApiValidationIssue {
  location: Array<string | number>;
  message: string;
  type: string;
}

export interface PublicApiErrorContract {
  fallbackCode: string;
  knownCodes: ReadonlySet<string>;
  parseIssues?: (value: unknown) => ApiValidationIssue[];
}

export interface ParsedPublicApiError {
  code: string;
  issues: ApiValidationIssue[];
}

export interface ApiMutationIdentity {
  idempotencyKey: string;
  requestFingerprint: string;
}

export interface ApiJsonResponse {
  data: unknown;
  headers: Headers;
  status: number;
}

interface ApiTransportErrorOptions {
  authenticationRecovery?: ApiAuthenticationRecovery;
  code: string;
  issues?: ApiValidationIssue[];
  outcome?: ApiMutationOutcome | null;
  reason: ApiTransportFailureReason;
  retryAfterSeconds?: number | null;
  status: number;
}

export class ApiTransportError extends Error {
  readonly authenticationRecovery: ApiAuthenticationRecovery;
  readonly code: string;
  readonly issues: ApiValidationIssue[];
  readonly outcome: ApiMutationOutcome | null;
  readonly reason: ApiTransportFailureReason;
  readonly retryAfterSeconds: number | null;
  readonly status: number;

  constructor({
    authenticationRecovery = null,
    code,
    issues = [],
    outcome = null,
    reason,
    retryAfterSeconds = null,
    status,
  }: ApiTransportErrorOptions) {
    super("Recipe Lab could not complete this request.");
    this.name = "ApiTransportError";
    this.authenticationRecovery = authenticationRecovery;
    this.code = code;
    this.issues = issues;
    this.outcome = outcome;
    this.reason = reason;
    this.retryAfterSeconds = retryAfterSeconds;
    this.status = status;
  }
}

interface ExecuteApiRequestOptions {
  errorContract: PublicApiErrorContract;
  kind: ApiRequestKind;
  responseBody?: "json" | "empty";
  signal?: AbortSignal;
  timeoutMs: number;
}

const API_PATH_ORIGIN = "https://recipe-lab.invalid";
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeIssues(
  value: unknown,
  parser: PublicApiErrorContract["parseIssues"],
): ApiValidationIssue[] {
  if (!parser) return [];
  try {
    return parser(value);
  } catch {
    return [];
  }
}

export function parsePublicApiError(
  value: unknown,
  contract: PublicApiErrorContract,
): ParsedPublicApiError {
  if (!isRecord(value) || !isRecord(value.error)) {
    return { code: contract.fallbackCode, issues: [] };
  }

  const code =
    typeof value.error.code === "string" &&
    contract.knownCodes.has(value.error.code)
      ? value.error.code
      : contract.fallbackCode;
  return {
    code,
    issues:
      code === contract.fallbackCode
        ? []
        : safeIssues(value.error.issues, contract.parseIssues),
  };
}

export function retryAfterSeconds(headers: Headers): number | null {
  const value = headers.get("Retry-After");
  if (!value || !/^\d+$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 ? seconds : null;
}

export function authenticationRecovery(
  status: number,
  code: string,
): ApiAuthenticationRecovery {
  if (code === "account_setup_required") return "complete_account_setup";
  if (code === "invalid_csrf") return "refresh_session";
  if (status === 401 || code === "authentication_required") return "sign_in";
  return null;
}

export function normalizeApiPath(path: string): string {
  if (
    !path.startsWith("/api/") ||
    path.startsWith("//") ||
    path.includes("\\") ||
    path.includes("#")
  ) {
    throw new TypeError("API targets must be relative /api/... paths.");
  }

  const parsed = new URL(path, API_PATH_ORIGIN);
  if (
    parsed.origin !== API_PATH_ORIGIN ||
    !parsed.pathname.startsWith("/api/")
  ) {
    throw new TypeError("API targets must be relative /api/... paths.");
  }
  return `${parsed.pathname}${parsed.search}`;
}

export function assertMutationIdentity(
  identity: ApiMutationIdentity,
): ApiMutationIdentity {
  if (
    typeof identity.idempotencyKey !== "string" ||
    identity.idempotencyKey.trim().length === 0 ||
    identity.idempotencyKey.length > 200 ||
    !SHA256_PATTERN.test(identity.requestFingerprint)
  ) {
    throw new TypeError(
      "Mutations require an idempotency key and lowercase SHA-256 request fingerprint.",
    );
  }
  return identity;
}

type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | CanonicalJsonValue[]
  | { [key: string]: CanonicalJsonValue };

function canonicalJson(value: CanonicalJsonValue): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("Request fingerprints require finite JSON numbers.");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

export async function createRequestFingerprint(
  document: CanonicalJsonValue,
): Promise<string> {
  const encoded = new TextEncoder().encode(canonicalJson(document));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function outcomeForHttpFailure(
  kind: ApiRequestKind,
  status: number,
): ApiMutationOutcome | null {
  if (kind !== "mutation") return null;
  if (status === 408) return "unknown";
  return status >= 400 && status < 500 ? "rejected" : "unknown";
}

function outcomeAfterDispatch(kind: ApiRequestKind): ApiMutationOutcome | null {
  return kind === "mutation" ? "unknown" : null;
}

function transportReason(
  timedOut: boolean,
  externalSignal: AbortSignal | undefined,
  error: unknown,
): ApiTransportFailureReason {
  if (timedOut) return "timeout";
  if (
    externalSignal?.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return "aborted";
  }
  return "network";
}

function executionError(
  reason: ApiTransportFailureReason,
  kind: ApiRequestKind,
): ApiTransportError {
  return new ApiTransportError({
    code:
      reason === "timeout"
        ? "request_timed_out"
        : reason === "aborted"
          ? "request_aborted"
          : "network_error",
    outcome: outcomeAfterDispatch(kind),
    reason,
    status: 0,
  });
}

async function publicApiError(
  response: Response,
  contract: PublicApiErrorContract,
): Promise<ParsedPublicApiError> {
  try {
    return parsePublicApiError(await response.json(), contract);
  } catch {
    return { code: contract.fallbackCode, issues: [] };
  }
}

async function executeJsonApiRequestOnce(
  target: string | URL,
  init: RequestInit,
  options: ExecuteApiRequestOptions,
): Promise<ApiJsonResponse> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new TypeError("API request timeouts must be positive whole milliseconds.");
  }
  if (options.signal?.aborted) {
    throw new ApiTransportError({
      code: "request_aborted",
      outcome: options.kind === "mutation" ? "rejected" : null,
      reason: "not_sent",
      status: 0,
    });
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener("abort", abortFromCaller, { once: true });
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("The request timed out.", "TimeoutError"));
  }, options.timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch(target, { ...init, signal: controller.signal });
    } catch (error) {
      throw executionError(
        transportReason(timedOut, options.signal, error),
        options.kind,
      );
    }

    if (!response.ok) {
      const parsed = await publicApiError(response, options.errorContract);
      throw new ApiTransportError({
        authenticationRecovery: authenticationRecovery(
          response.status,
          parsed.code,
        ),
        code: parsed.code,
        issues: parsed.issues,
        outcome: outcomeForHttpFailure(options.kind, response.status),
        reason: "http",
        retryAfterSeconds: retryAfterSeconds(response.headers),
        status: response.status,
      });
    }

    if (options.responseBody === "empty") {
      return { data: null, headers: response.headers, status: response.status };
    }

    try {
      return {
        data: await response.json(),
        headers: response.headers,
        status: response.status,
      };
    } catch (error) {
      if (
        timedOut ||
        options.signal?.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        throw executionError(
          transportReason(timedOut, options.signal, error),
          options.kind,
        );
      }
      throw new ApiTransportError({
        code: "invalid_api_response",
        outcome: outcomeAfterDispatch(options.kind),
        reason: "invalid_response",
        status: 502,
      });
    }
  } finally {
    globalThis.clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abortFromCaller);
  }
}

export async function executeJsonApiRequest(
  target: string | URL,
  init: RequestInit,
  options: ExecuteApiRequestOptions,
): Promise<ApiJsonResponse> {
  if (options.kind === "mutation") {
    return executeJsonApiRequestOnce(target, init, options);
  }

  try {
    return await retryTransientRead(
      () => executeJsonApiRequestOnce(target, init, options),
      { signal: options.signal },
    );
  } catch (error) {
    if (options.signal?.aborted && !(error instanceof ApiTransportError)) {
      throw executionError("aborted", options.kind);
    }
    throw error;
  }
}
