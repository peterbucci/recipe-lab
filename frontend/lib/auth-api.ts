export interface AccountUser {
  id: string;
  handle: string | null;
  display_name: string;
}

export interface AnonymousAuthSession {
  status: "anonymous";
}

export interface OnboardingAuthSession {
  status: "onboarding_required";
  user: AccountUser;
}

export interface AuthenticatedAuthSession {
  status: "authenticated";
  user: AccountUser & { handle: string };
}

export type AuthSession =
  | AnonymousAuthSession
  | OnboardingAuthSession
  | AuthenticatedAuthSession;

export interface AccountProfileInput {
  handle: string;
  display_name: string;
}

export interface ApiValidationIssue {
  location: Array<string | number>;
  message: string;
  type: string;
}

interface ApiErrorPayload {
  error?: {
    code?: unknown;
    message?: unknown;
    issues?: unknown;
  };
}

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

export const AUTH_SESSION_EXPIRED_EVENT = "recipe-lab:auth-session-expired";
export const CSRF_COOKIE_NAME = "recipe_lab_csrf";

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
    (value.handle !== null && typeof value.handle !== "string")
  ) {
    return null;
  }

  return {
    id: value.id,
    display_name: value.display_name,
    handle: value.handle,
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
  if (value.status === "onboarding_required" && user) {
    return { status: value.status, user };
  }
  if (value.status === "authenticated" && user?.handle) {
    return {
      status: value.status,
      user: { ...user, handle: user.handle },
    };
  }

  throw new AuthApiError(
    "Recipe Lab received an invalid account response.",
    502,
    "invalid_auth_response",
  );
}

function parseValidationIssues(value: unknown): ApiValidationIssue[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((issue) => {
    if (
      !isRecord(issue) ||
      !Array.isArray(issue.location) ||
      !issue.location.every(
        (part) => typeof part === "string" || typeof part === "number",
      ) ||
      typeof issue.message !== "string" ||
      typeof issue.type !== "string"
    ) {
      return [];
    }
    return [
      {
        location: issue.location as Array<string | number>,
        message: issue.message,
        type: issue.type,
      },
    ];
  });
}

function isErrorPayload(value: unknown): value is ApiErrorPayload {
  return isRecord(value) && "error" in value;
}

async function apiError(response: Response): Promise<AuthApiError> {
  let message = "Recipe Lab could not update your account.";
  let code = "auth_api_error";
  let issues: ApiValidationIssue[] = [];

  try {
    const payload: unknown = await response.json();
    if (isErrorPayload(payload) && isRecord(payload.error)) {
      if (typeof payload.error.message === "string") {
        message = payload.error.message;
      }
      if (typeof payload.error.code === "string") {
        code = payload.error.code;
      }
      issues = parseValidationIssues(payload.error.issues);
    }
  } catch {
    // Keep the stable fallback instead of exposing an upstream response body.
  }

  return new AuthApiError(message, response.status, code, issues);
}

function notifySessionExpired() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  }
}

async function authFetch(path: string, init: RequestInit): Promise<Response> {
  const response = await fetch(path, {
    ...init,
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    if (response.status === 401) {
      notifySessionExpired();
    }
    throw await apiError(response);
  }

  return response;
}

export async function fetchAuthSession(signal?: AbortSignal): Promise<AuthSession> {
  const response = await authFetch("/api/auth/session", {
    method: "GET",
    signal,
  });
  return parseAuthSession(await response.json());
}

export function readCookie(name: string, cookieHeader?: string): string | null {
  const cookies =
    cookieHeader ?? (typeof document === "undefined" ? "" : document.cookie);

  for (const entry of cookies.split(";")) {
    const [rawName, ...rawValueParts] = entry.trim().split("=");
    if (rawName !== name) {
      continue;
    }

    const rawValue = rawValueParts.join("=");
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }

  return null;
}

function csrfHeaders(): HeadersInit {
  const csrfToken = readCookie(CSRF_COOKIE_NAME);
  if (!csrfToken) {
    notifySessionExpired();
    throw new AuthApiError(
      "Your session expired. Sign in again to continue.",
      401,
      "csrf_token_unavailable",
    );
  }

  return { "X-CSRF-Token": csrfToken };
}

export async function updateAccountProfile(
  profile: AccountProfileInput,
): Promise<AuthenticatedAuthSession> {
  const response = await authFetch("/api/auth/session/profile", {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      ...csrfHeaders(),
    },
    body: JSON.stringify(profile),
  });
  const session = parseAuthSession(await response.json());

  if (session.status !== "authenticated") {
    throw new AuthApiError(
      "Recipe Lab received an invalid account response.",
      502,
      "invalid_auth_response",
    );
  }

  return session;
}

export async function signOut(): Promise<void> {
  await authFetch("/api/auth/logout", {
    method: "POST",
    headers: csrfHeaders(),
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
