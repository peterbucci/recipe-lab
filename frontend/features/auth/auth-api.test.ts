import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT, CSRF_COOKIE_NAME } from "../../shared/api/browser-session";
import {
  AuthApiError,
  fetchAuthSession,
  parseAuthSession,
  reauthenticateHref,
  safeReturnTo,
  signInHref,
  signOut,
} from "./auth-api";

afterEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  vi.unstubAllGlobals();
});

describe("auth API client", () => {
  it("parses only the documented public session DTO", () => {
    expect(parseAuthSession({ status: "anonymous" })).toEqual({
      status: "anonymous",
    });
    expect(
      parseAuthSession({
        status: "authenticated",
        user: {
          id: "cook-id",
          display_name: "Alice Cook",
          handle: "alice",
          description: "Weeknight recipes and bread experiments.",
          email: "not-copied@example.test",
        },
        capabilities: {
          review_ingredient_requests: true,
          moderate_recipe_reports: false,
        },
      }),
    ).toEqual({
      status: "authenticated",
      user: {
        id: "cook-id",
        display_name: "Alice Cook",
        handle: "alice",
        description: "Weeknight recipes and bread experiments.",
      },
      capabilities: {
        review_ingredient_requests: true,
        moderate_recipe_reports: false,
      },
    });
    expect(() =>
      parseAuthSession({
        status: "authenticated",
        user: { id: "cook-id", display_name: "Alice Cook", handle: null },
      }),
    ).toThrow(AuthApiError);
    expect(() =>
      parseAuthSession({
        status: "authenticated",
        user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        capabilities: {
          review_ingredient_requests: "yes",
          moderate_recipe_reports: false,
        },
      }),
    ).toThrow(AuthApiError);
  });

  it("loads account status through the same-origin boundary without caching", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: "anonymous" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchAuthSession()).resolves.toEqual({ status: "anonymous" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe("/api/auth/session");
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
      redirect: "error",
    });
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
  });

  it("reads the CSRF cookie and sends it for logout mutations", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token%20value; Path=/`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(signOut()).resolves.toBeUndefined();

    const [logoutTarget, logoutInit] = fetchMock.mock.calls[0];
    expect(logoutTarget).toBe("/api/auth/logout");
    expect(logoutInit).toMatchObject({ method: "POST" });
    const logoutHeaders = new Headers(logoutInit?.headers);
    expect(logoutHeaders.get("Accept")).toBe("application/json");
    expect(logoutHeaders.get("X-CSRF-Token")).toBe("token value");
  });

  it("reports a missing CSRF cookie as an expired session without making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const listener = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, listener);
    vi.stubGlobal("fetch", fetchMock);

    const error = await signOut().catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      status: 401,
      code: "csrf_token_unavailable",
    });
    expect(listener).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, listener);
  });

  it("does not retry auth mutations after the request is dispatched", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token; Path=/`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "authentication_unavailable", issues: [] } },
          { status: 503 },
        ),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(signOut()).rejects.toMatchObject({
      code: "authentication_unavailable",
      status: 503,
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not retain invalid auth response bodies", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token; Path=/`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("private upstream details", { status: 502 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(signOut()).rejects.toMatchObject({
      status: 502,
      code: "auth_api_error",
      message: "Recipe Lab could not update your account.",
    });
  });

  it("preserves session expiration without retaining backend messages", async () => {
    const internalId = "99999999-9999-4999-8999-999999999999";
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "authentication_required",
                message: `Session UUID ${internalId} expired.`,
                issues: [],
              },
            },
            { status: 401 },
          ),
        ),
    );

    const unauthorized = await fetchAuthSession().catch(
      (reason: unknown) => reason,
    );
    expect(unauthorized).toMatchObject({
      status: 401,
      code: "authentication_required",
      message: "Your session expired. Sign in again to continue.",
    });
    expect(expired).toHaveBeenCalledOnce();
    expect(
      `${String(unauthorized)} ${JSON.stringify(unauthorized)}`,
    ).not.toMatch(/session uuid|99999999/i);
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });
});

describe("auth URL helpers", () => {
  it("keeps only local return paths", () => {
    expect(safeReturnTo("/recipes?q=carrot#results")).toBe(
      "/recipes?q=carrot#results",
    );
    expect(safeReturnTo("https://malicious.example/steal")).toBe("/recipes");
    expect(safeReturnTo("//malicious.example/steal")).toBe("/recipes");
    expect(signInHref("/onboarding")).toBe(
      "/api/auth/login?return_to=%2Fonboarding",
    );
    expect(reauthenticateHref("/account/settings")).toBe(
      "/api/auth/reauthenticate?return_to=%2Faccount%2Fsettings",
    );
  });


});
