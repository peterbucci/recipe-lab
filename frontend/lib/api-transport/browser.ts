"use client";

import {
  AuthApiError,
  memberMutationHeaders,
  notifySessionExpired,
} from "../auth-api";
import {
  ApiTransportError,
  assertMutationIdentity,
  executeJsonApiRequest,
  normalizeApiPath,
  type ApiJsonResponse,
  type ApiMutationIdentity,
  type PublicApiErrorContract,
} from "./core";

export const BROWSER_API_TIMEOUT_MS = 15_000;

interface BrowserRequestBase {
  body?: BodyInit | null;
  errorContract: PublicApiErrorContract;
  headers?: HeadersInit;
  responseBody?: "json" | "empty";
  signal?: AbortSignal;
  timeoutMs?: number;
}

interface BrowserQueryRequest extends BrowserRequestBase {
  kind: "query";
  method?: "GET" | "HEAD";
  retry?: "never" | "transient";
}

interface BrowserMutationRequest extends BrowserRequestBase {
  csrf: "member";
  identity: ApiMutationIdentity;
  kind: "mutation";
  method: "DELETE" | "PATCH" | "POST" | "PUT";
}

export type BrowserApiRequestOptions =
  | BrowserQueryRequest
  | BrowserMutationRequest;

function memberHeaders(): Record<string, string> {
  try {
    return memberMutationHeaders();
  } catch (error) {
    if (error instanceof AuthApiError) {
      throw new ApiTransportError({
        authenticationRecovery: "sign_in",
        code: error.code,
        outcome: "rejected",
        reason: "not_sent",
        status: error.status,
      });
    }
    throw error;
  }
}

export async function browserApiRequest(
  path: string,
  options: BrowserApiRequestOptions,
): Promise<ApiJsonResponse> {
  const target = normalizeApiPath(path);
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  if (options.kind === "mutation") {
    const identity = assertMutationIdentity(options.identity);
    headers.set("Idempotency-Key", identity.idempotencyKey);
    for (const [name, value] of Object.entries(memberHeaders())) {
      headers.set(name, value);
    }
  }

  try {
    return await executeJsonApiRequest(
      target,
      {
        body: options.body,
        cache: "no-store",
        credentials: "same-origin",
        headers,
        method: options.method ?? "GET",
        redirect: "error",
      },
      {
        errorContract: options.errorContract,
        kind: options.kind,
        responseBody: options.responseBody,
        retry: options.kind === "query" ? options.retry : undefined,
        signal: options.signal,
        timeoutMs: options.timeoutMs ?? BROWSER_API_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (error instanceof ApiTransportError && error.status === 401) {
      notifySessionExpired();
    }
    throw error;
  }
}
