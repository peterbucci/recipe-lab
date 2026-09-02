// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MeasurementUnitApiError,
  catalogUnitSummary,
  fetchMeasurementUnits,
  parseMeasurementUnitResponse,
  type CatalogUnit,
} from "./measurement-unit-api";

const gram: CatalogUnit = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  key: "gram",
  dimension: "mass",
  canonical_label: "gram",
  plural_label: "grams",
  symbol: "g",
  display_style: "symbol",
  aliases: ["gram", "grams"],
  active: true,
  provenance: "Reviewed SI seed data.",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("measurement unit API", () => {
  it("fetches the semantic catalog once without caching and strictly parses it", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test/");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ items: [gram] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchMeasurementUnits("ingredient_amount")).resolves.toEqual([
      gram,
    ]);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe(
      "http://api.example.test/api/measurement-units?semantic=ingredient_amount",
    );
    expect(init).toMatchObject({
      cache: "no-store",
      method: "GET",
      redirect: "error",
    });
    expect(init).not.toHaveProperty("credentials");
    expect(new Headers(init?.headers).get("Accept")).toBe("application/json");
  });

  it("rejects malformed or duplicate catalog identities", () => {
    expect(
      parseMeasurementUnitResponse({
        items: [
          {
            ...gram,
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            dimension: "package",
          },
        ],
      }).items[0].dimension,
    ).toBe("package");
    expect(() =>
      parseMeasurementUnitResponse({
        items: [{ ...gram, dimension: "distance" }],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "invalid_measurement_unit_response",
        status: 502,
      }),
    );
    expect(() =>
      parseMeasurementUnitResponse({
        items: [{ ...gram, display_style: "abbreviation" }],
      }),
    ).toThrow("invalid measurement unit response");
    expect(() =>
      parseMeasurementUnitResponse({ items: [{ ...gram, symbol: null }] }),
    ).toThrow("invalid measurement unit response");
    expect(() => parseMeasurementUnitResponse({ items: [gram, gram] })).toThrow(
      "invalid measurement unit response",
    );
  });

  it("keeps aliases and provenance out of the recipe-facing summary", () => {
    expect(catalogUnitSummary(gram)).toEqual({
      id: gram.id,
      key: "gram",
      dimension: "mass",
      canonical_label: "gram",
      plural_label: "grams",
      symbol: "g",
      display_style: "symbol",
      active: true,
    });
  });

  it("preserves a documented error and hides a non-JSON upstream body", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () => {
        requestCount += 1;
        if (requestCount === 1) {
          return new Response(
            JSON.stringify({
              error: {
                code: "invalid_semantic",
                message: "Choose a supported semantic.",
              },
            }),
            { status: 422, headers: { "Content-Type": "application/json" } },
          );
        }
        if (requestCount <= 3) {
          return new Response("private gateway details", { status: 503 });
        }
        return Response.json(
          {
            error: {
              code: "internal_operator_policy_failure",
              message:
                "Canonical unit UUID 99999999-9999-4999-8999-999999999999 failed an operator policy.",
            },
          },
          { status: 503 },
        );
      }),
    );

    await expect(
      fetchMeasurementUnits("action_duration"),
    ).rejects.toMatchObject({
      code: "invalid_semantic",
      message: "Review the measurement selection and try again.",
      status: 422,
    });
    const error = await fetchMeasurementUnits("temperature").catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(MeasurementUnitApiError);
    expect(error).toMatchObject({
      code: "measurement_unit_api_error",
      message: "The measurement unit service could not complete this request.",
      status: 503,
    });
    expect(String(error)).not.toContain("private gateway details");

    const hostileError = await fetchMeasurementUnits("ingredient_amount").catch(
      (reason: unknown) => reason,
    );
    expect(hostileError).toMatchObject({
      code: "measurement_unit_api_error",
      message: "The measurement unit service could not complete this request.",
      status: 503,
    });
    expect(
      `${String(hostileError)} ${JSON.stringify(hostileError)}`,
    ).not.toMatch(/99999999|canonical|uuid|operator|policy|internal_/i);
    expect(requestCount).toBe(5);
  });

  it("maps an unreadable successful body to the validated response error", async () => {
    vi.stubEnv("RECIPE_API_URL", "http://api.example.test");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("not-json", {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    await expect(fetchMeasurementUnits("temperature")).rejects.toMatchObject({
      code: "invalid_measurement_unit_response",
      status: 502,
    });
  });
});
