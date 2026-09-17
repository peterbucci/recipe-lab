import { afterEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT, CSRF_COOKIE_NAME } from "../../shared/api/browser-session";
import { deferred } from "../../tests/support/deferred";
import {
  AuthApiError,
  fetchAuthSession,
  parseAuthSession,
  reauthenticateHref,
  safeReturnTo,
  signInHref,
  signOut,
  startDemoSession,
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

describe("temporary demo entry protocol", () => {
  const generation = "f80a52ee-02ac-479e-a8db-848a2b093638";
  const guest = {
    status: "authenticated",
    temporary: true,
    expires_at: "2026-09-17T12:00:00Z",
    user: { id: "visitor-id", handle: "demo_visitor", display_name: "Demo visitor" },
  };

  function installSerialLocks() {
    const queues = new Map<string, Promise<unknown>>();
    const request = vi.fn((
      name: string,
      optionsOrCallback: LockOptions | (() => Promise<unknown>),
      suppliedCallback?: () => Promise<unknown>,
    ) => {
      const callback = typeof optionsOrCallback === "function"
        ? optionsOrCallback : suppliedCallback;
      if (!callback) throw new Error("A lock callback is required.");
      const running = (queues.get(name) ?? Promise.resolve()).then(callback);
      queues.set(name, running.catch(() => undefined));
      return running;
    });
    vi.stubGlobal("navigator", { locks: { request } });
    return request;
  }

  it("reuses only the pending memory credential after an uncertain entry response", async () => {
    installSerialLocks();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }))
      .mockRejectedValueOnce(new TypeError("connection lost"))
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }))
      .mockResolvedValueOnce(Response.json(guest));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startDemoSession(generation, new AbortController().signal))
      .rejects.toMatchObject({ reason: "network", outcome: "unknown" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(startDemoSession(generation, new AbortController().signal))
      .resolves.toEqual(guest);

    const first = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    const retry = JSON.parse(String(fetchMock.mock.calls[3][1]?.body));
    expect(first.entry_key).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(retry.entry_key === first.entry_key).toBe(true);
    expect(retry.generation_id).toBe(generation);
    expect(sessionStorage.length).toBe(0);
    expect(localStorage.length).toBe(0);
  });

  it("recovers a completed entry from the active session without another issuance", async () => {
    installSerialLocks();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(guest));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startDemoSession(generation, new AbortController().signal))
      .resolves.toEqual(guest);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/session");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  it("discards the pending retry credential once active-session recovery confirms entry", async () => {
    installSerialLocks();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }))
      .mockRejectedValueOnce(new TypeError("response lost"))
      .mockResolvedValueOnce(Response.json(guest))
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }))
      .mockResolvedValueOnce(Response.json(guest));
    vi.stubGlobal("fetch", fetchMock);

    await expect(startDemoSession(generation, new AbortController().signal)).rejects.toBeDefined();
    await expect(startDemoSession(generation, new AbortController().signal)).resolves.toEqual(guest);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await startDemoSession(generation, new AbortController().signal);

    const previous = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    const fresh = JSON.parse(String(fetchMock.mock.calls[4][1]?.body));
    expect(fresh.entry_key === previous.entry_key).toBe(false);
  });

  it("holds the same browser lock through entry and subsequent logout", async () => {
    const locks = installSerialLocks();
    const entryResponse = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }))
      .mockReturnValueOnce(entryResponse.promise)
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    const entering = startDemoSession(generation, new AbortController().signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const leaving = signOut();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(locks.mock.calls[0][0]).toBe(locks.mock.calls[1][0]);

    // Browser applies the new cookies before resolving a successful entry.
    document.cookie = `${CSRF_COOKIE_NAME}=synthetic-demo-csrf; Path=/`;
    entryResponse.resolve(Response.json(guest));
    await expect(entering).resolves.toEqual(guest);
    await expect(leaving).resolves.toBeUndefined();
    expect(fetchMock.mock.calls[2][0]).toBe("/api/auth/logout");
  });

  it("starts fresh only after logout has finished", async () => {
    const locks = installSerialLocks();
    const logoutResponse = deferred<Response>();
    document.cookie = `${CSRF_COOKIE_NAME}=synthetic-demo-csrf; Path=/`;
    const fetchMock = vi.fn<typeof fetch>()
      .mockReturnValueOnce(logoutResponse.promise)
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }))
      .mockResolvedValueOnce(Response.json(guest));
    vi.stubGlobal("fetch", fetchMock);

    const leaving = signOut();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const entering = startDemoSession(generation, new AbortController().signal);
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(locks.mock.calls[0][0]).toBe(locks.mock.calls[1][0]);
    logoutResponse.resolve(new Response(null, { status: 204 }));
    await leaving;
    await expect(entering).resolves.toEqual(guest);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/auth/logout", "/api/auth/session", "/api/auth/demo",
    ]);
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
