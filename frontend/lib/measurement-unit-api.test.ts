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

    await expect(fetchMeasurementUnits("ingredient_amount")).resolves.toEqual([gram]);
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://api.example.test/api/measurement-units?semantic=ingredient_amount"),
      { cache: "no-store", headers: { Accept: "application/json" } },
    );
  });

  it("rejects malformed or duplicate catalog identities", () => {
    expect(
      parseMeasurementUnitResponse({
        items: [{ ...gram, id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", dimension: "package" }],
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
      parseMeasurementUnitResponse({ items: [{ ...gram, display_style: "abbreviation" }] }),
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
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              error: { code: "invalid_semantic", message: "Choose a supported semantic." },
            }),
            { status: 422, headers: { "Content-Type": "application/json" } },
          ),
        )
        .mockResolvedValueOnce(new Response("private gateway details", { status: 503 })),
    );

    await expect(fetchMeasurementUnits("action_duration")).rejects.toMatchObject({
      code: "invalid_semantic",
      message: "Choose a supported semantic.",
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
  });
});
