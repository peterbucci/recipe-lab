import {
  assertMutationIdentity,
  executeJsonApiRequest,
  normalizeApiPath,
  type ApiJsonResponse,
  type ApiMutationIdentity,
  type PublicApiErrorContract,
} from "./core";

export const SERVER_API_TIMEOUT_MS = 10_000;

export interface ApiEnvironment {
  NEXT_PUBLIC_API_URL?: string;
  RECIPE_API_URL?: string;
}

interface ServerRequestBase {
  body?: BodyInit | null;
  environment?: ApiEnvironment;
  errorContract: PublicApiErrorContract;
  headers?: HeadersInit;
  responseBody?: "json" | "empty";
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface ServerQueryRequest extends ServerRequestBase {
  kind: "query";
  method?: "GET" | "HEAD";
}

interface ServerMutationRequest extends ServerRequestBase {
  identity: ApiMutationIdentity;
  kind: "mutation";
  method: "DELETE" | "PATCH" | "POST" | "PUT";
}

export type ServerApiRequestOptions = ServerQueryRequest | ServerMutationRequest;

function assertServerRuntime(): void {
  if (typeof window !== "undefined") {
    throw new Error("The internal recipe API transport is server-only.");
  }
}

function invalidOrigin(): never {
  throw new Error(
    "The internal recipe API origin must be an HTTP(S) origin without credentials, path, query, or hash.",
  );
}

export function resolveServerApiOrigin(
  environment?: ApiEnvironment,
): string {
  assertServerRuntime();
  const resolvedEnvironment = environment ?? {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    RECIPE_API_URL: process.env.RECIPE_API_URL,
  };
  const configured =
    resolvedEnvironment.RECIPE_API_URL ??
    resolvedEnvironment.NEXT_PUBLIC_API_URL ??
    "http://localhost:8000";
  const value = configured.trim();
  if (!value) return invalidOrigin();

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return invalidOrigin();
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    return invalidOrigin();
  }
  return parsed.origin;
}

export function serverApiUrl(
  path: string,
  environment?: ApiEnvironment,
): URL {
  assertServerRuntime();
  return new URL(normalizeApiPath(path), `${resolveServerApiOrigin(environment)}/`);
}

export async function serverApiRequest(
  path: string,
  options: ServerApiRequestOptions,
): Promise<ApiJsonResponse> {
  assertServerRuntime();
  const headers = new Headers(options.headers);
  if (headers.has("Cookie") || headers.has("X-CSRF-Token")) {
    throw new TypeError(
      "Internal server requests cannot carry browser cookies or CSRF headers.",
    );
  }
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (options.kind === "mutation") {
    headers.set(
      "Idempotency-Key",
      assertMutationIdentity(options.identity).idempotencyKey,
    );
  }

  return executeJsonApiRequest(
    serverApiUrl(path, options.environment),
    {
      body: options.body,
      cache: "no-store",
      headers,
      method: options.method ?? "GET",
      redirect: "error",
    },
    {
      errorContract: options.errorContract,
      kind: options.kind,
      responseBody: options.responseBody,
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? SERVER_API_TIMEOUT_MS,
    },
  );
}
