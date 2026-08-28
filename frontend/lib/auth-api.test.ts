import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_SESSION_EXPIRED_EVENT,
  AuthApiError,
  CSRF_COOKIE_NAME,
  deleteAccount,
  fetchAuthSession,
  parseAuthSession,
  readCookie,
  reauthenticateHref,
  safeReturnTo,
  signInHref,
  signOut,
  updateAccountProfile,
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
          email: "not-copied@example.test",
        },
        capabilities: {
          review_ingredient_requests: true,
          moderate_recipe_reports: false,
        },
      }),
    ).toEqual({
      status: "authenticated",
      user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
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

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/session", {
      method: "GET",
      signal: undefined,
      cache: "no-store",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
  });

  it("reads the CSRF cookie and sends it for profile, logout, and deletion mutations", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token%20value; Path=/`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateAccountProfile({ handle: "alice", display_name: "Alice Cook" }),
    ).resolves.toMatchObject({ status: "authenticated" });
    await expect(signOut()).resolves.toBeUndefined();
    await expect(deleteAccount("alice")).resolves.toBeUndefined();

    expect(fetchMock.mock.calls[0]).toEqual([
      "/api/auth/session/profile",
      expect.objectContaining({
        method: "PATCH",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": "token value",
        },
      }),
    ]);
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: {
          Accept: "application/json",
          "X-CSRF-Token": "token value",
        },
      }),
    ]);
    expect(fetchMock.mock.calls[2]).toEqual([
      "/api/auth/account",
      expect.objectContaining({
        method: "DELETE",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-CSRF-Token": "token value",
        },
        body: JSON.stringify({ confirmation: "alice" }),
      }),
    ]);
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

  it("preserves known account codes without retaining backend messages", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token; Path=/`;
    const internalId = "99999999-9999-4999-8999-999999999999";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "handle_unavailable",
              message: `Canonical handle policy ${internalId} rejected this operator request.`,
              issues: [],
            },
          },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(
        new Response("private upstream details", { status: 502 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const handleError = await updateAccountProfile({
      handle: "alice",
      display_name: "Alice",
    }).catch((reason: unknown) => reason);
    expect(handleError).toMatchObject({
      status: 409,
      code: "handle_unavailable",
      message: "That handle is unavailable.",
    });
    expect(`${String(handleError)} ${JSON.stringify(handleError)}`).not.toMatch(
      /canonical|policy|operator|99999999/i,
    );
    await expect(signOut()).rejects.toMatchObject({
      status: 502,
      code: "auth_api_error",
      message: "Recipe Lab could not update your account.",
    });
  });

  it("keeps only safe profile validation paths and replaces hostile issue details", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token; Path=/`;
    const internalId = "99999999-9999-4999-8999-999999999999";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "validation_error",
              message: `Canonical account policy ${internalId} failed.`,
              issues: [
                {
                  location: ["body", "handle"],
                  message: `Operator UUID ${internalId} failed the canonical policy.`,
                  type: "internal_handle_policy_failure",
                },
                {
                  location: ["body", "display_name"],
                  message: "Private operator detail.",
                  type: "internal_display_name_policy_failure",
                },
                {
                  location: ["body", internalId],
                  message: "Private identifier detail.",
                  type: "internal_error",
                },
              ],
            },
          },
          { status: 422 },
        ),
      ),
    );

    const error = await updateAccountProfile({
      handle: "bad",
      display_name: "Alice",
    }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({
      code: "validation_error",
      message:
        "Some account details need attention. Review them and try again.",
      issues: [
        {
          location: ["body", "handle"],
          message:
            "Use a handle with 3–30 lowercase letters, numbers, underscores, or hyphens.",
          type: "validation_error",
        },
        {
          location: ["body", "display_name"],
          message: "Enter a display name with 1–120 visible characters.",
          type: "validation_error",
        },
      ],
    });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
      /canonical|policy|operator|private|99999999|internal_/i,
    );
  });

  it("drops unknown backend codes and preserves session and recent-authentication behavior", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token; Path=/`;
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
                code: "private_operator_policy_failure",
                message: `Account UUID ${internalId} failed canonical policy.`,
                issues: [],
              },
            },
            { status: 409 },
          ),
        )
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
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "recent_authentication_required",
                message: `Operator policy ${internalId} requires reauthentication.`,
                issues: [],
              },
            },
            { status: 403 },
          ),
        ),
    );

    const unknown = await updateAccountProfile({
      handle: "alice",
      display_name: "Alice",
    }).catch((reason: unknown) => reason);
    expect(unknown).toMatchObject({
      status: 409,
      code: "auth_api_error",
      message: "Recipe Lab could not update your account.",
      issues: [],
    });

    const unauthorized = await fetchAuthSession().catch(
      (reason: unknown) => reason,
    );
    expect(unauthorized).toMatchObject({
      status: 401,
      code: "authentication_required",
      message: "Your session expired. Sign in again to continue.",
    });
    expect(expired).toHaveBeenCalledOnce();

    const recentAuthentication = await deleteAccount("alice").catch(
      (reason: unknown) => reason,
    );
    expect(recentAuthentication).toMatchObject({
      status: 403,
      code: "recent_authentication_required",
      message: "Sign in again to verify your identity before continuing.",
    });
    expect(
      `${String(unknown)} ${JSON.stringify(unknown)} ${String(unauthorized)} ${JSON.stringify(unauthorized)} ${String(recentAuthentication)} ${JSON.stringify(recentAuthentication)}`,
    ).not.toMatch(/canonical|policy|operator|99999999|private_operator/i);
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

  it("decodes cookie values without losing embedded equals signs", () => {
    expect(readCookie("wanted", "other=one; wanted=a%3Db; third=three")).toBe(
      "a=b",
    );
    expect(readCookie("missing", "other=one")).toBeNull();
  });
});
