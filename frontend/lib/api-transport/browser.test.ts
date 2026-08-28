import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT, CSRF_COOKIE_NAME } from "../auth-api";
import { browserApiRequest } from "./browser";
import { ApiTransportError, type PublicApiErrorContract } from "./core";

const ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "api_error",
  knownCodes: new Set([
    "account_setup_required",
    "authentication_required",
    "invalid_csrf",
  ]),
};
const IDENTITY = {
  idempotencyKey: "report-key",
  requestFingerprint: "a".repeat(64),
};

beforeEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=test-token; Path=/`;
});

afterEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  vi.unstubAllGlobals();
});

describe("same-origin browser API transport", () => {
  it("merges protected mutation headers with fixed browser request behavior", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ received: true }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserApiRequest("/api/recipes/one/reports?source=detail", {
        body: JSON.stringify({ reason: "spam" }),
        csrf: "member",
        errorContract: ERROR_CONTRACT,
        headers: new Headers({
          accept: "application/vnd.recipe-lab+json",
          "content-type": "application/json",
          "x-csrf-token": "caller-value-must-not-win",
        }),
        identity: IDENTITY,
        kind: "mutation",
        method: "POST",
      }),
    ).resolves.toMatchObject({ data: { received: true }, status: 201 });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(target).toBe("/api/recipes/one/reports?source=detail");
    expect(init).toMatchObject({
      body: JSON.stringify({ reason: "spam" }),
      cache: "no-store",
      credentials: "same-origin",
      method: "POST",
      redirect: "error",
    });
    expect(headers.get("Accept")).toBe("application/vnd.recipe-lab+json");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe("report-key");
    expect(headers.get("X-CSRF-Token")).toBe("test-token");
  });

  it.each([
    "https://api.example.test/api/recipes",
    "//api.example.test/api/recipes",
    "/api/../private",
    "/api/recipes#private",
    "/api\\recipes",
  ])("rejects the non-relative or escaping browser target %s", async (target) => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      browserApiRequest(target, {
        errorContract: ERROR_CONTRACT,
        kind: "query",
      }),
    ).rejects.toThrow("relative /api/");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports missing CSRF as a definite not-sent operation", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);

    const error = await browserApiRequest("/api/recipes/one/reports", {
      csrf: "member",
      errorContract: ERROR_CONTRACT,
      identity: IDENTITY,
      kind: "mutation",
      method: "POST",
    }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiTransportError);
    expect(error).toMatchObject({
      authenticationRecovery: "sign_in",
      code: "csrf_token_unavailable",
      outcome: "rejected",
      reason: "not_sent",
      status: 401,
    });
    expect(expired).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it.each([
    {
      code: "authentication_required",
      recovery: "sign_in",
      status: 401,
    },
    {
      code: "account_setup_required",
      recovery: "complete_account_setup",
      status: 403,
    },
    { code: "invalid_csrf", recovery: "refresh_session", status: 403 },
  ])(
    "exposes explicit $recovery recovery for $code",
    async ({ code, recovery, status }) => {
      const expired = vi.fn();
      window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
      const fetchMock = vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ error: { code } }, { status }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        browserApiRequest("/api/recipes/one/reports", {
          csrf: "member",
          errorContract: ERROR_CONTRACT,
          identity: IDENTITY,
          kind: "mutation",
          method: "POST",
        }),
      ).rejects.toMatchObject({ authenticationRecovery: recovery, status });
      expect(expired).toHaveBeenCalledTimes(status === 401 ? 1 : 0);
      expect(fetchMock).toHaveBeenCalledOnce();
      window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    },
  );
});
