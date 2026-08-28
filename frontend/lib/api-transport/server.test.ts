// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  resolveServerApiOrigin,
  serverApiRequest,
  serverApiUrl,
  type ApiEnvironment,
} from "./server";
import type { PublicApiErrorContract } from "./core";

const ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "api_error",
  knownCodes: new Set(),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("internal server API transport", () => {
  it("preserves private, public, and localhost origin precedence", () => {
    expect(
      resolveServerApiOrigin({
        RECIPE_API_URL: "https://private.example.test/",
        NEXT_PUBLIC_API_URL: "https://public.example.test",
      }),
    ).toBe("https://private.example.test");
    expect(
      resolveServerApiOrigin({
        NEXT_PUBLIC_API_URL: "http://public.example.test:8000/",
      }),
    ).toBe("http://public.example.test:8000");
    expect(resolveServerApiOrigin({})).toBe("http://localhost:8000");
  });

  it.each([
    { RECIPE_API_URL: "" },
    { RECIPE_API_URL: "not-a-url" },
    { RECIPE_API_URL: "ftp://api.example.test" },
    { RECIPE_API_URL: "https://user:secret@api.example.test" },
    { RECIPE_API_URL: "https://api.example.test/private" },
    { RECIPE_API_URL: "https://api.example.test?secret=value" },
    { RECIPE_API_URL: "https://api.example.test#secret" },
  ] satisfies ApiEnvironment[])("rejects invalid configured origins", (environment) => {
    expect(() => resolveServerApiOrigin(environment)).toThrow(
      "internal recipe API origin",
    );
    expect(() => resolveServerApiOrigin(environment)).not.toThrow(
      /user|secret|private|value/i,
    );
  });

  it("builds only internal API URLs while preserving the query", () => {
    expect(
      serverApiUrl("/api/recipes?page=2", {
        RECIPE_API_URL: "https://api.example.test/",
      }).toString(),
    ).toBe("https://api.example.test/api/recipes?page=2");
    expect(() =>
      serverApiUrl("https://hostile.example/api/recipes", {
        RECIPE_API_URL: "https://api.example.test",
      }),
    ).toThrow("relative /api/");
    expect(() =>
      serverApiUrl("/api/../private", {
        RECIPE_API_URL: "https://api.example.test",
      }),
    ).toThrow("relative /api/");
  });

  it("refuses to run when a browser runtime is present", () => {
    vi.stubGlobal("window", {});

    expect(() =>
      resolveServerApiOrigin({ RECIPE_API_URL: "https://api.example.test" }),
    ).toThrow("server-only");
  });

  it("uses no-store JSON requests without browser credentials", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await serverApiRequest("/api/recipes?page=1", {
      environment: { RECIPE_API_URL: "https://api.example.test" },
      errorContract: ERROR_CONTRACT,
      headers: new Headers({ "X-Request-Source": "server" }),
      kind: "query",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(String(target)).toBe("https://api.example.test/api/recipes?page=1");
    expect(init).toMatchObject({
      cache: "no-store",
      method: "GET",
      redirect: "error",
    });
    expect(init).not.toHaveProperty("credentials");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("X-Request-Source")).toBe("server");
    expect(headers.has("Cookie")).toBe(false);
    expect(headers.has("X-CSRF-Token")).toBe(false);
  });

  it.each(["Cookie", "X-CSRF-Token"])(
    "rejects the browser-only %s header before dispatch",
    async (name) => {
      const fetchMock = vi.fn<typeof fetch>();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        serverApiRequest("/api/recipes", {
          environment: { RECIPE_API_URL: "https://api.example.test" },
          errorContract: ERROR_CONTRACT,
          headers: { [name]: "private" },
          kind: "query",
        }),
      ).rejects.toThrow("cannot carry browser cookies or CSRF");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );
});
