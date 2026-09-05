import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildNetworkSignalHeaders,
  internalNetworkSignalSecret,
  NETWORK_HEADER,
  NETWORK_SIGNATURE_HEADER,
  NETWORK_TIMESTAMP_HEADER,
} from "../../../server/trusted-network-signal.mjs";

import * as routeModule from "./route";
import { GET, PATCH } from "./route";

const CORRELATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function mockFetchUntilTimeout() {
  const timeoutController = new AbortController();
  const timeoutSpy = vi
    .spyOn(AbortSignal, "timeout")
    .mockReturnValue(timeoutController.signal);
  const fetchMock = vi.fn<typeof fetch>().mockImplementation(
    (input) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = (input as Request).signal;
        const rejectForAbort = () =>
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        if (signal.aborted) {
          rejectForAbort();
          return;
        }
        signal.addEventListener("abort", rejectForAbort, { once: true });
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, timeoutController, timeoutSpy };
}

function captureOperationalErrors() {
  return vi.spyOn(console, "error").mockImplementation(() => undefined);
}

describe("same-origin API boundary", () => {
  it("exports only Next-supported route handlers and segment configuration", () => {
    expect(Object.keys(routeModule).sort()).toEqual([
      "DELETE",
      "GET",
      "HEAD",
      "OPTIONS",
      "PATCH",
      "POST",
      "PUT",
      "dynamic",
      "runtime",
    ]);
  });

  it("forwards path, query, cookies, and manual redirects to the private backend", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://recipe-api.internal:8000/");
    const upstreamCorrelationId = "5a7fd15f-5f6c-4a26-a35a-c12c5647cdea";
    const upstreamHeaders = new Headers({
      Location: "https://identity.example/authorize",
      "Content-Encoding": "gzip",
      "Content-Length": "123",
      "X-Correlation-ID": upstreamCorrelationId,
    });
    upstreamHeaders.append(
      "Set-Cookie",
      "recipe_lab_login=flow; HttpOnly; SameSite=Lax; Path=/api/auth/callback",
    );
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 302, headers: upstreamHeaders }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("http://recipe.test/api/auth/login?return_to=%2Frecipes", {
        headers: {
          Cookie: "recipe_lab_session=session-value",
          Host: "recipe.test",
          Origin: "http://recipe.test",
        },
      }),
      { params: Promise.resolve({ path: ["auth", "login"] }) },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://identity.example/authorize");
    expect(response.headers.get("set-cookie")).toContain("recipe_lab_login=flow");
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    expect(response.headers.get("x-correlation-id")).toBe(upstreamCorrelationId);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [request, init] = fetchMock.mock.calls[0];
    expect(request).toBeInstanceOf(Request);
    const forwarded = request as Request;
    expect(forwarded.url).toBe(
      "http://recipe-api.internal:8000/api/auth/login?return_to=%2Frecipes",
    );
    expect(forwarded.headers.get("cookie")).toBe("recipe_lab_session=session-value");
    expect(forwarded.headers.get("origin")).toBe("http://recipe.test");
    expect(forwarded.headers.get("host")).toBeNull();
    expect(init).toEqual({ cache: "no-store", redirect: "manual" });
  });

  it("forwards unsafe request bodies and CSRF headers", async () => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (request) => {
      const forwarded = request as Request;
      expect(forwarded.method).toBe("PATCH");
      expect(forwarded.headers.get("x-csrf-token")).toBe("csrf-value");
      expect(await forwarded.json()).toEqual({ handle: "alice" });
      return Response.json({ status: "authenticated" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await PATCH(
      new NextRequest("http://recipe.test/api/auth/session/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "csrf-value",
        },
        body: JSON.stringify({ handle: "alice" }),
      }),
      { params: Promise.resolve({ path: ["auth", "session", "profile"] }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("strips caller forwarding and forged internal-network headers", async () => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (request) => {
      const forwarded = request as Request;
      expect(forwarded.headers.get("forwarded")).toBeNull();
      expect(forwarded.headers.get("x-forwarded-for")).toBeNull();
      expect(forwarded.headers.get("x-real-ip")).toBeNull();
      expect(forwarded.headers.get(NETWORK_HEADER)).toBeNull();
      expect(forwarded.headers.get(NETWORK_TIMESTAMP_HEADER)).toBeNull();
      expect(forwarded.headers.get(NETWORK_SIGNATURE_HEADER)).toBeNull();
      expect(forwarded.headers.get("x-correlation-id")).toBeNull();
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("https://recipe.test/api/recipes", {
        headers: {
          Forwarded: "for=198.51.100.9",
          "X-Forwarded-For": "198.51.100.9",
          "X-Real-IP": "198.51.100.9",
          [NETWORK_HEADER]: "198.51.100.0/24",
          [NETWORK_TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1000)),
          [NETWORK_SIGNATURE_HEADER]: "0".repeat(64),
          "X-Correlation-ID": "forged-account-derived-value",
        },
      }),
      { params: Promise.resolve({ path: ["recipes"] }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("forwards a fresh signal created by the hardened frontend boundary", async () => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    const secret = internalNetworkSignalSecret();
    const signal = buildNetworkSignalHeaders({
      remoteAddress: "203.0.113.45",
      method: "GET",
      path: "/api/recipes",
      secret,
    });
    expect(signal).not.toBeNull();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (request) => {
      const forwarded = request as Request;
      expect(forwarded.headers.get(NETWORK_HEADER)).toBe("203.0.113.0/24");
      expect(forwarded.headers.get(NETWORK_TIMESTAMP_HEADER)).toBe(
        signal?.[NETWORK_TIMESTAMP_HEADER],
      );
      expect(forwarded.headers.get(NETWORK_SIGNATURE_HEADER)).toBe(
        signal?.[NETWORK_SIGNATURE_HEADER],
      );
      return Response.json({ ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("https://recipe.test/api/recipes", { headers: signal ?? {} }),
      { params: Promise.resolve({ path: ["recipes"] }) },
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns a stable no-store gateway error without exposing internal details", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://recipe-api.internal:8000");
    const privateCanary = "secret-host-private-draft-session-email@example.test";
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error(privateCanary)));
    const consoleError = captureOperationalErrors();

    const response = await GET(
      new NextRequest("http://recipe.test/api/recipes"),
      { params: Promise.resolve({ path: ["recipes"] }) },
    );

    expect(response.status).toBe(502);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: {
        code: "api_unavailable",
        message: "Recipe Lab could not reach the recipe service.",
        issues: [],
      },
    });
    expect(payload.error.correlation_id).toMatch(CORRELATION_ID_PATTERN);
    expect(response.headers.get("x-correlation-id")).toBe(payload.error.correlation_id);
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0]?.[0]).toBe(
      JSON.stringify({
        event: "recipe_lab.frontend.recipe_api_unavailable",
        correlation_id: payload.error.correlation_id,
        status_code: 502,
      }),
    );
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(privateCanary);
  });

  it.each([
    ["parent traversal", ["..", "private"]],
    ["current-directory traversal", [".", "private"]],
    ["decoded slash", ["auth/session", "private"]],
    ["backslash", ["auth\\session", "private"]],
    ["control character", ["auth\u0000session", "private"]],
  ])("rejects %s segments before contacting the backend", async (_label, path) => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new NextRequest("http://recipe.test/api/auth/session"),
      { params: Promise.resolve({ path }) },
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      error: { code: "invalid_api_path" },
    });
    expect(payload.error.correlation_id).toMatch(CORRELATION_ID_PATTERN);
    expect(response.headers.get("x-correlation-id")).toBe(payload.error.correlation_id);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [400, "invalid_login"],
    [422, "invalid_login"],
    [503, "authentication_unavailable"],
  ])(
    "turns a callback %i into a safe UI redirect without reflecting provider input",
    async (status, expectedCode) => {
      vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
      const consoleError = captureOperationalErrors();
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json(
            {
              error: {
                code: "provider-secret-code",
                message: "provider-secret-message",
              },
            },
            { status },
          ),
        ),
      );

      const response = await GET(
        new NextRequest(
          "https://recipe.test/api/auth/callback?code=secret-code&state=secret-state&error=provider-secret",
        ),
        { params: Promise.resolve({ path: ["auth", "callback"] }) },
      );

      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(
        `/auth/callback?error=${expectedCode}`,
      );
      expect(response.headers.get("set-cookie")).toBe(
        "recipe_lab_login=; Path=/api/auth/callback; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
      );
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("referrer-policy")).toBe("no-referrer");
      expect(response.headers.get("x-correlation-id")).toMatch(CORRELATION_ID_PATTERN);
      const serializedHeaders = JSON.stringify([...response.headers.entries()]);
      expect(serializedHeaders).not.toContain("secret-code");
      expect(serializedHeaders).not.toContain("secret-state");
      expect(serializedHeaders).not.toContain("provider-secret");
      expect(JSON.stringify(consoleError.mock.calls)).not.toContain("provider-secret");
      expect(consoleError).toHaveBeenCalledOnce();
      await expect(response.text()).resolves.toBe("");
    },
  );

  it("passes a successful callback redirect and session cookies through unchanged", async () => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    const headers = new Headers({
      Location: "/onboarding",
      "Set-Cookie": "recipe_lab_session=session; HttpOnly; Secure; SameSite=Lax; Path=/",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, { status: 303, headers }),
      ),
    );

    const response = await GET(
      new NextRequest("https://recipe.test/api/auth/callback?code=code&state=state"),
      { params: Promise.resolve({ path: ["auth", "callback"] }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/onboarding");
    expect(response.headers.get("set-cookie")).toContain("recipe_lab_session=session");
  });

  it("preserves callback rate-limit JSON and Retry-After instead of redirecting", async () => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "rate_limit_exceeded",
              message: "Too many requests. Please try again later.",
              issues: [],
            },
          },
          { status: 429, headers: { "Retry-After": "23" } },
        ),
      ),
    );

    const response = await GET(
      new NextRequest("https://recipe.test/api/auth/callback?code=code&state=state"),
      { params: Promise.resolve({ path: ["auth", "callback"] }) },
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("23");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("recipe_lab_login=;");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "rate_limit_exceeded",
        message: "Too many requests. Please try again later.",
        issues: [],
      },
    });
  });

  it("passes a transaction-validated reauthentication failure destination unchanged", async () => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    const safeLocation =
      "/auth/callback?error=reauthentication_failed&return_to=%2Faccount%2Fsettings";
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 303,
          headers: {
            Location: safeLocation,
            "Set-Cookie":
              "recipe_lab_login=; Max-Age=0; HttpOnly; Secure; SameSite=Lax; Path=/api/auth/callback",
          },
        }),
      ),
    );

    const response = await GET(
      new NextRequest(
        "https://recipe.test/api/auth/callback?code=provider-secret&state=state-secret&return_to=https://malicious.example",
      ),
      { params: Promise.resolve({ path: ["auth", "callback"] }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(safeLocation);
    expect(response.headers.get("location")).not.toContain("malicious.example");
    expect(response.headers.get("set-cookie")).toContain("recipe_lab_login=;");
  });

  it.each([
    "https://malicious.example/steal",
    "//malicious.example/steal",
    "/\\malicious.example/steal",
  ])("rejects unsafe callback redirect %s", async (location) => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    captureOperationalErrors();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(null, {
          status: 303,
          headers: { Location: location },
        }),
      ),
    );

    const response = await GET(
      new NextRequest("https://recipe.test/api/auth/callback?code=secret&state=short"),
      { params: Promise.resolve({ path: ["auth", "callback"] }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/auth/callback?error=authentication_unavailable",
    );
    expect(response.headers.get("location")).not.toContain("malicious.example");
  });

  it("sanitizes a callback when the backend cannot be reached", async () => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    const consoleError = captureOperationalErrors();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockRejectedValue(new Error("internal backend details")),
    );

    const response = await GET(
      new NextRequest(
        "https://recipe.test/api/auth/callback?code=provider-secret&state=state-secret",
      ),
      { params: Promise.resolve({ path: ["auth", "callback"] }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/auth/callback?error=authentication_unavailable",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "recipe_lab_login=; Path=/api/auth/callback; Max-Age=0",
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-correlation-id")).toMatch(CORRELATION_ID_PATTERN);
    expect(JSON.stringify([...response.headers.entries()])).not.toContain("provider-secret");
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("provider-secret");
    await expect(response.text()).resolves.toBe("");
  });

  it("bounds an unreachable API request and returns the stable gateway error", async () => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    captureOperationalErrors();
    const { fetchMock, timeoutController, timeoutSpy } = mockFetchUntilTimeout();

    const responsePromise = GET(
      new NextRequest("https://recipe.test/api/recipes"),
      { params: Promise.resolve({ path: ["recipes"] }) },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    timeoutController.abort(new DOMException("Timed out", "TimeoutError"));
    const response = await responsePromise;

    expect(timeoutSpy).toHaveBeenCalledWith(10_000);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "api_unavailable" },
    });
  });

  it("bounds an unreachable callback and reaches the sanitized error UI", async () => {
    vi.stubEnv("RECIPE_API_URL", "https://api.example.test");
    captureOperationalErrors();
    const { fetchMock, timeoutController } = mockFetchUntilTimeout();

    const responsePromise = GET(
      new NextRequest(
        "https://recipe.test/api/auth/callback?code=provider-secret&state=state-secret",
      ),
      { params: Promise.resolve({ path: ["auth", "callback"] }) },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    timeoutController.abort(new DOMException("Timed out", "TimeoutError"));
    const response = await responsePromise;

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/auth/callback?error=authentication_unavailable",
    );
    expect(response.headers.get("set-cookie")).toContain("recipe_lab_login=;");
    expect(JSON.stringify([...response.headers.entries()])).not.toContain("provider-secret");
  });
});
