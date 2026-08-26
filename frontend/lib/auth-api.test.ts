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
    expect(parseAuthSession({ status: "anonymous" })).toEqual({ status: "anonymous" });
    expect(
      parseAuthSession({
        status: "authenticated",
        user: {
          id: "cook-id",
          display_name: "Alice Cook",
          handle: "alice",
          email: "not-copied@example.test",
        },
        capabilities: { review_ingredient_requests: true },
      }),
    ).toEqual({
      status: "authenticated",
      user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
      capabilities: { review_ingredient_requests: true },
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
        capabilities: { review_ingredient_requests: "yes" },
      }),
    ).toThrow(AuthApiError);
  });

  it("loads account status through the same-origin boundary without caching", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ status: "anonymous" }),
    );
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
    await expect(deleteAccount()).resolves.toBeUndefined();

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
          "X-CSRF-Token": "token value",
        },
      }),
    ]);
  });

  it("reports a missing CSRF cookie as an expired session without making a request", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const listener = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, listener);
    vi.stubGlobal("fetch", fetchMock);

    const error = await signOut().catch((reason: unknown) => reason);

    expect(error).toMatchObject({ status: 401, code: "csrf_token_unavailable" });
    expect(listener).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, listener);
  });

  it("preserves safe validation errors and does not expose a non-JSON body", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token; Path=/`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "handle_unavailable",
              message: "That handle is unavailable.",
              issues: [],
            },
          },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(new Response("private upstream details", { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      updateAccountProfile({ handle: "alice", display_name: "Alice" }),
    ).rejects.toMatchObject({
      status: 409,
      code: "handle_unavailable",
      message: "That handle is unavailable.",
    });
    await expect(signOut()).rejects.toMatchObject({
      status: 502,
      code: "auth_api_error",
      message: "Recipe Lab could not update your account.",
    });
  });

  it("keeps structured backend validation locations", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=token; Path=/`;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "validation_error",
              message: "The request parameters are invalid.",
              issues: [
                {
                  location: ["body", "handle"],
                  message: "String should match pattern.",
                  type: "string_pattern_mismatch",
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
      issues: [
        {
          location: ["body", "handle"],
          message: "String should match pattern.",
          type: "string_pattern_mismatch",
        },
      ],
    });
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
    expect(readCookie("wanted", "other=one; wanted=a%3Db; third=three")).toBe("a=b");
    expect(readCookie("missing", "other=one")).toBeNull();
  });
});
