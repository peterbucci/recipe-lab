import type { IncomingMessage, ServerResponse } from "node:http";

import { describe, expect, it, vi } from "vitest";

import { handleHealthCheck } from "./server.mjs";

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
