import { ApiTransportError } from "./core";

export const AUTH_SESSION_EXPIRED_EVENT = "recipe-lab:auth-session-expired";
export const CSRF_COOKIE_NAME = "recipe_lab_csrf";

export function notifySessionExpired() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(AUTH_SESSION_EXPIRED_EVENT));
  }
}

export function readCookie(name: string, cookieHeader?: string): string | null {
  const cookies =
    cookieHeader ?? (typeof document === "undefined" ? "" : document.cookie);

  for (const entry of cookies.split(";")) {
    const [rawName, ...rawValueParts] = entry.trim().split("=");
    if (rawName !== name) continue;
    const rawValue = rawValueParts.join("=");
    try {
      return decodeURIComponent(rawValue);
    } catch {
      return rawValue;
    }
  }
  return null;
}

export function memberMutationHeaders(): Record<string, string> {
  const csrfToken = readCookie(CSRF_COOKIE_NAME);
  if (!csrfToken) {
    notifySessionExpired();
    throw new ApiTransportError({
      authenticationRecovery: "sign_in",
      code: "csrf_token_unavailable",
      outcome: "rejected",
      reason: "not_sent",
      status: 401,
    });
  }
  return { "X-CSRF-Token": csrfToken };
}
