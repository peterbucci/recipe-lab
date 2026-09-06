import type { operations } from "../../shared/api/generated/generated";
import {
  ApiTransportError,
  executeJsonApiRequest,
  normalizeApiPath,
  type ApiJsonResponse,
  type ApiValidationIssue,
  type PublicApiErrorContract,
} from "../../shared/api/core";

import {
  memberMutationHeaders as browserMemberMutationHeaders,
  notifySessionExpired,
} from "../../shared/api/browser-session";

type AccountSessionOperation =
  operations["account_session_api_auth_session_get"];
type AccountSessionResponseContract =
  AccountSessionOperation["responses"][200]["content"]["application/json"];
type MemberSessionContract = Extract<
  AccountSessionResponseContract,
  { readonly user: unknown }
>;
export type AccountUser = Omit<MemberSessionContract["user"], "handle"> & {
  handle: string | null;
};

export type AccountCapabilities = NonNullable<
  MemberSessionContract["capabilities"]
>;

export interface AnonymousAuthSession {
  status: "anonymous";
}

export interface OnboardingAuthSession {
  status: "onboarding_required";
  user: AccountUser;
  capabilities?: AccountCapabilities;
}

export interface AuthenticatedAuthSession {
  status: "authenticated";
  user: AccountUser & { handle: string };
  capabilities?: AccountCapabilities;
}

export type AuthSession =
  AnonymousAuthSession | OnboardingAuthSession | AuthenticatedAuthSession;

export class AuthApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: ApiValidationIssue[];

  constructor(
    message: string,
    status: number,
    code = "auth_api_error",
    issues: ApiValidationIssue[] = [],
  ) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

const FALLBACK_RETURN_TO = "/recipes";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseUser(value: unknown): AccountUser | null {
  if (!isRecord(value)) {
    return null;
  }

  if (
    typeof value.id !== "string" ||
    typeof value.display_name !== "string" ||
    (value.handle !== null && typeof value.handle !== "string") ||
    (value.description !== undefined &&
      value.description !== null &&
      (typeof value.description !== "string" || value.description.length > 500))
  ) {
    return null;
  }

  return {
    id: value.id,
    display_name: value.display_name,
    handle: value.handle,
    ...(value.description !== undefined
      ? { description: value.description as string | null }
      : {}),
  };
}

function parseCapabilities(
  value: unknown,
): AccountCapabilities | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (
    !isRecord(value) ||
    typeof value.moderate_recipe_reports !== "boolean" ||
    typeof value.review_ingredient_requests !== "boolean"
  ) {
    return null;
  }
  return {
    moderate_recipe_reports: value.moderate_recipe_reports,
    review_ingredient_requests: value.review_ingredient_requests,
  };
}

export function parseAuthSession(value: unknown): AuthSession {
  if (!isRecord(value) || typeof value.status !== "string") {
    throw new AuthApiError(
      "Recipe Lab received an invalid account response.",
      502,
      "invalid_auth_response",
    );
  }

  if (value.status === "anonymous") {
    return { status: "anonymous" };
  }

  const user = parseUser(value.user);
  const capabilities = parseCapabilities(value.capabilities);
  if (capabilities === null) {
    throw new AuthApiError(
      "Recipe Lab received an invalid account response.",
      502,
      "invalid_auth_response",
    );
  }
  if (value.status === "onboarding_required" && user) {
    return {
      status: value.status,
      user,
      ...(capabilities ? { capabilities } : {}),
    };
  }
  if (value.status === "authenticated" && user?.handle) {
    return {
      status: value.status,
      user: { ...user, handle: user.handle },
      ...(capabilities ? { capabilities } : {}),
    };
  }

  throw new AuthApiError(
    "Recipe Lab received an invalid account response.",
    502,
    "invalid_auth_response",
  );
}

const KNOWN_AUTH_ERROR_CODES = new Set([
  "account_confirmation_invalid",
  "account_setup_required",
  "abuse_protection_unavailable",
  "authentication_required",
  "authentication_unavailable",
  "handle_unavailable",
  "invalid_csrf",
  "invalid_identifier",
  "invalid_login",
  "invalid_return_path",
  "rate_limit_exceeded",
  "recent_authentication_required",
  "validation_error",
]);

const AUTH_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "auth_api_error",
  knownCodes: KNOWN_AUTH_ERROR_CODES,
  parseIssues: parseValidationIssues,
};

const AUTH_API_TIMEOUT_MS = 15_000;

type ProfileValidationField = "description" | "display_name" | "handle";

function safeProfileIssueLocation(
  value: unknown,
): ["body", ProfileValidationField] | null {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    value[0] !== "body" ||
    (value[1] !== "handle" &&
      value[1] !== "display_name" &&
      value[1] !== "description")
  ) {
    return null;
  }
  return ["body", value[1]];
}

function safeProfileIssueMessage(field: ProfileValidationField): string {
  if (field === "handle") {
    return "Use a handle with 3–30 lowercase letters, numbers, underscores, or hyphens.";
  }
  return field === "description"
    ? "Keep your profile description to 500 visible characters or fewer."
    : "Enter a display name with 1–120 visible characters.";
}

function parseValidationIssues(value: unknown): ApiValidationIssue[] {
  if (!Array.isArray(value) || value.length > 20) return [];

  const seen = new Set<ProfileValidationField>();
  const issues: ApiValidationIssue[] = [];
  for (const issue of value) {
    if (!isRecord(issue)) continue;
    const location = safeProfileIssueLocation(issue.location);
    if (!location) continue;
    const field = location[1];
    if (seen.has(field)) continue;
    seen.add(field);
    issues.push({
      location,
      message: safeProfileIssueMessage(field),
      type: "validation_error",
    });
  }
  return issues;
}

function safeAuthErrorMessage(status: number, code: string): string {
  if (status === 401 || code === "authentication_required") {
    return "Your session expired. Sign in again to continue.";
  }
  if (code === "handle_unavailable") return "That handle is unavailable.";
  if (code === "recent_authentication_required") {
    return "Sign in again to verify your identity before continuing.";
  }
  if (code === "account_confirmation_invalid") {
    return "The confirmation did not match. Nothing was changed.";
  }
  if (status === 422 || code === "validation_error") {
    return "Some account details need attention. Review them and try again.";
  }
  if (status === 403 || code === "invalid_csrf") {
    return "Recipe Lab could not verify this account request. Refresh the page and try again.";
  }
  if (status === 429 || code === "rate_limit_exceeded") {
    return "Too many account requests were made. Please try again later.";
  }
  if (
    code === "authentication_unavailable" ||
    code === "abuse_protection_unavailable"
  ) {
    return "Account access is temporarily unavailable. Please try again.";
  }
  return "Recipe Lab could not update your account.";
}

export interface AuthRequestOptions {
  body?: BodyInit | null;
  headers?: Record<string, string>;
  kind: "mutation" | "query";
  method: "DELETE" | "GET" | "PATCH" | "POST";
  responseBody?: "empty" | "json";
  signal?: AbortSignal;
}

function fromTransportError(error: ApiTransportError): AuthApiError {
  if (error.reason === "invalid_response") {
    return new AuthApiError(
      "Recipe Lab received an invalid account response.",
      502,
      "invalid_auth_response",
    );
  }
  return new AuthApiError(
    safeAuthErrorMessage(error.status, error.code),
    error.status,
    error.code,
    error.code === "validation_error" ? error.issues : [],
  );
}

export async function authRequest(
  path: string,
  options: AuthRequestOptions,
): Promise<ApiJsonResponse> {
  const headers = { Accept: "application/json", ...options.headers };

  try {
    return await executeJsonApiRequest(
      normalizeApiPath(path),
      {
        body: options.body,
        cache: "no-store",
        credentials: "same-origin",
        headers,
        method: options.method,
        redirect: "error",
      },
      {
        errorContract: AUTH_ERROR_CONTRACT,
        kind: options.kind,
        responseBody: options.responseBody,
        retry: "never",
        signal: options.signal,
        timeoutMs: AUTH_API_TIMEOUT_MS,
      },
    );
  } catch (error) {
    if (error instanceof ApiTransportError) {
      if (
        (error.reason === "aborted" || error.reason === "not_sent") &&
        options.signal?.aborted
      ) {
        throw (
          options.signal.reason ??
          new DOMException("The request was aborted.", "AbortError")
        );
      }
      if (error.reason === "network" || error.reason === "timeout") {
        throw error;
      }
      if (error.status === 401) notifySessionExpired();
      throw fromTransportError(error);
    }
    throw error;
  }
}

export async function fetchAuthSession(
  signal?: AbortSignal,
): Promise<AuthSession> {
  const response = await authRequest("/api/auth/session", {
    kind: "query",
    method: "GET",
    signal,
  });
  return parseAuthSession(response.data);
}

export function memberMutationHeaders(): Record<string, string> {
  try {
    return browserMemberMutationHeaders();
  } catch (error) {
    if (error instanceof ApiTransportError) throw fromTransportError(error);
    throw error;
  }
}

export async function signOut(): Promise<void> {
  await authRequest("/api/auth/logout", {
    kind: "mutation",
    method: "POST",
    headers: memberMutationHeaders(),
    responseBody: "empty",
  });
}

export function safeReturnTo(value: string | null | undefined): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return FALLBACK_RETURN_TO;
  }

  try {
    const origin = "https://recipe-lab.invalid";
    const parsed = new URL(value, origin);
    if (parsed.origin !== origin) {
      return FALLBACK_RETURN_TO;
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return FALLBACK_RETURN_TO;
  }
}

export function signInHref(returnTo?: string | null): string {
  const query = new URLSearchParams({ return_to: safeReturnTo(returnTo) });
  return `/api/auth/login?${query.toString()}`;
}

export function reauthenticateHref(returnTo = "/account/settings"): string {
  const query = new URLSearchParams({ return_to: safeReturnTo(returnTo) });
  return `/api/auth/reauthenticate?${query.toString()}`;
}
