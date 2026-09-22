import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import {
  createReadinessProbe,
  handleHealthCheck,
  handleReadinessCheck,
} from "../server.mjs";

function responseDouble() {
  const headers = new Map<string, string | number>();
  const end = vi.fn();
  return {
    headers,
    end,
    response: {
      statusCode: 0,
      setHeader(name: string, value: string | number) {
        headers.set(name, value);
      },
      end,
    } as unknown as ServerResponse,
  };
}

describe("frontend process health", () => {
  it("answers GET and HEAD without involving Next.js", () => {
    const get = responseDouble();
    const head = responseDouble();

    expect(
      handleHealthCheck({ method: "GET" } as IncomingMessage, get.response, "/healthz"),
    ).toBe(true);
    expect(
      handleHealthCheck({ method: "HEAD" } as IncomingMessage, head.response, "/healthz"),
    ).toBe(true);

    expect(get.response.statusCode).toBe(200);
    expect(get.headers.get("Cache-Control")).toBe("no-store");
    expect(get.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(get.headers.get("Content-Length")).toBe(3);
    expect(get.end).toHaveBeenCalledWith("ok\n");
    expect(head.end).toHaveBeenCalledWith(undefined);
  });

  it("rejects unsupported methods and ignores other paths", () => {
    const unsupported = responseDouble();
    const unrelated = responseDouble();

    expect(
      handleHealthCheck(
        { method: "POST" } as IncomingMessage,
        unsupported.response,
        "/healthz",
      ),
    ).toBe(true);
    expect(unsupported.response.statusCode).toBe(405);
    expect(unsupported.headers.get("Allow")).toBe("GET, HEAD");
    expect(
      handleHealthCheck({ method: "GET" } as IncomingMessage, unrelated.response, "/recipes"),
    ).toBe(false);
    expect(unrelated.end).not.toHaveBeenCalled();
  });
});

describe("frontend whole-stack readiness", () => {
  it("reports ready only after the backend dependency check succeeds", async () => {
    const get = responseDouble();
    const head = responseDouble();
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response('{"status":"ready"}', { status: 200 }));
    const readinessProbe = createReadinessProbe({
      recipeApiUrl: "http://recipe-api.internal:8000",
      fetchImpl,
    });

    await expect(
      handleReadinessCheck(
        { method: "GET" } as IncomingMessage,
        get.response,
        "/readyz",
        { readinessProbe },
      ),
    ).resolves.toBe(true);
    await expect(
      handleReadinessCheck(
        { method: "HEAD" } as IncomingMessage,
        head.response,
        "/readyz",
        { readinessProbe },
      ),
    ).resolves.toBe(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toEqual(
      new URL("http://recipe-api.internal:8000/api/readiness"),
    );
    expect(fetchImpl.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        redirect: "error",
        signal: expect.any(AbortSignal),
      }),
    );
    expect(get.response.statusCode).toBe(200);
    expect(get.headers.get("Cache-Control")).toBe("no-store");
    expect(get.headers.get("Pragma")).toBe("no-cache");
    expect(get.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    expect(get.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(get.end).toHaveBeenCalledWith("ready\n");
    expect(head.end).toHaveBeenCalledWith(undefined);
  });

  it.each([
    ["backend rejection", vi.fn().mockRejectedValue(new Error("private database error"))],
    [
      "backend unavailability",
      vi.fn().mockResolvedValue(
        new Response('{"detail":"private database error"}', {
          status: 503,
          headers: { "X-Private-Diagnostic": "do-not-forward" },
        }),
      ),
    ],
  ])("fails closed without exposing %s details", async (_name, fetchImpl) => {
    const result = responseDouble();
    const readinessProbe = createReadinessProbe({
      recipeApiUrl: "http://recipe-api.internal:8000",
      fetchImpl,
    });

    await handleReadinessCheck(
      { method: "GET" } as IncomingMessage,
      result.response,
      "/readyz",
      { readinessProbe },
    );

    expect(result.response.statusCode).toBe(503);
    expect(result.headers.get("Cache-Control")).toBe("no-store");
    expect(result.headers.get("Pragma")).toBe("no-cache");
    expect(result.headers.has("X-Private-Diagnostic")).toBe(false);
    expect(result.end).toHaveBeenCalledWith("unavailable\n");
    expect(JSON.stringify([...result.headers, ...result.end.mock.calls])).not.toContain(
      "private database error",
    );
  });

  it("rejects unsupported methods without contacting the backend", async () => {
    const unsupported = responseDouble();
    const unrelated = responseDouble();
    const readinessProbe = vi.fn<() => Promise<boolean>>();

    await expect(
      handleReadinessCheck(
        { method: "POST" } as IncomingMessage,
        unsupported.response,
        "/readyz",
        { readinessProbe },
      ),
    ).resolves.toBe(true);
    await expect(
      handleReadinessCheck(
        { method: "GET" } as IncomingMessage,
        unrelated.response,
        "/recipes",
        { readinessProbe },
      ),
    ).resolves.toBe(false);

    expect(unsupported.response.statusCode).toBe(405);
    expect(unsupported.headers.get("Allow")).toBe("GET, HEAD");
    expect(unsupported.headers.get("Cache-Control")).toBe("no-store");
    expect(readinessProbe).not.toHaveBeenCalled();
  });

  it("coalesces concurrent probes into one backend request", async () => {
    let resolveFetch: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    const readinessProbe = createReadinessProbe({
      recipeApiUrl: "http://recipe-api.internal:8000",
      fetchImpl,
    });

    const probes = Array.from({ length: 24 }, () => readinessProbe());
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    resolveFetch?.(new Response(null, { status: 200 }));

    await expect(Promise.all(probes)).resolves.toEqual(Array(24).fill(true));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("uses a short bounded cache and retries after a cached failure expires", async () => {
    let now = 10_000;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const readinessProbe = createReadinessProbe({
      recipeApiUrl: "http://recipe-api.internal:8000",
      fetchImpl,
      monotonicClock: () => now,
      cacheTtlMs: 1_000,
    });

    await expect(readinessProbe()).resolves.toBe(false);
    now += 999;
    await expect(readinessProbe()).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 2;
    await expect(readinessProbe()).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["missing", vi.fn().mockRejectedValue(new Error("ENOENT"))],
    [
      "not a regular file",
      vi.fn().mockResolvedValue({ isFile: () => false, mtimeMs: 99_000 }),
    ],
    [
      "stale",
      vi.fn().mockResolvedValue({ isFile: () => true, mtimeMs: 69_999 }),
    ],
    [
      "too far in the future",
      vi.fn().mockResolvedValue({ isFile: () => true, mtimeMs: 102_001 }),
    ],
  ])("fails closed for a %s supervisor heartbeat", async (_name, statImpl) => {
    const fetchImpl = vi.fn();
    const readinessProbe = createReadinessProbe({
      recipeApiUrl: "http://recipe-api.internal:8000",
      fetchImpl,
      supervisorHeartbeat: {
        path: "/run/recipe-lab-supervisor/heartbeat",
        ttlSeconds: 30,
      },
      statImpl,
      wallClock: () => 100_000,
    });

    await expect(readinessProbe()).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("requires the heartbeat to remain fresh through the backend probe", async () => {
    const statImpl = vi
      .fn()
      .mockResolvedValueOnce({ isFile: () => true, mtimeMs: 99_000 })
      .mockResolvedValueOnce({ isFile: () => true, mtimeMs: 0 });
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const readinessProbe = createReadinessProbe({
      recipeApiUrl: "http://recipe-api.internal:8000",
      fetchImpl,
      supervisorHeartbeat: {
        path: "/run/recipe-lab-supervisor/heartbeat",
        ttlSeconds: 30,
      },
      statImpl,
      wallClock: () => 100_000,
    });

    await expect(readinessProbe()).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("recovers when the supervisor heartbeat becomes fresh", async () => {
    let modifiedAt = 0;
    const statImpl = vi.fn().mockImplementation(async () => ({
      isFile: () => true,
      mtimeMs: modifiedAt,
    }));
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    const readinessProbe = createReadinessProbe({
      recipeApiUrl: "http://recipe-api.internal:8000",
      fetchImpl,
      supervisorHeartbeat: {
        path: "/run/recipe-lab-supervisor/heartbeat",
        ttlSeconds: 30,
      },
      statImpl,
      wallClock: () => 100_000,
    });

    await expect(readinessProbe()).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();

    modifiedAt = 99_000;
    await expect(readinessProbe()).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(statImpl).toHaveBeenLastCalledWith(
      "/run/recipe-lab-supervisor/heartbeat",
    );
  });
});
