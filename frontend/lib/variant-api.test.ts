import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeDetail } from "./recipe-api";
import {
  VariantApiError,
  createRecipeVariant,
  type RecipeVariantCreateRequest,
} from "./variant-api";

const sourceRecipeVersionId = "29454eba/3a4e?5380";
const idempotencyKey = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const payload: RecipeVariantCreateRequest = {
  title: "Orange Pecan Carrot Cake",
  description: null,
  servings: "8.00",
  ingredient_edits: [
    {
      op: "set_quantity",
      recipe_ingredient_id: "sugar-row",
      quantity: "140.0000",
    },
    {
      op: "replace",
      recipe_ingredient_id: "walnut-row",
      ingredient_name: "Pecan",
    },
  ],
  instruction_edits: [
    {
      op: "update",
      recipe_instruction_id: "mix-step",
      text: "Fold until just combined.",
    },
  ],
};

function createdRecipe(): RecipeDetail {
  return {
    id: "8f0fe3cc-df03-4db7-bdc7-78ccfb97d54f",
    lineage_id: "6a032da8-f02d-4f8c-937f-7f776ad35799",
    parent_version_id: "29454eba-3a4e-5380-b48c-c49dc3697b17",
    version_number: 4,
    title: payload.title,
    description: payload.description,
    servings: payload.servings,
    created_at: "2026-08-21T12:00:00Z",
    average_rating: null,
    rating_count: 0,
    viewer_state: {
      recipe_version_id: "8f0fe3cc-df03-4db7-bdc7-78ccfb97d54f",
      saved: false,
      rating: null,
    },
    parent: {
      id: "29454eba-3a4e-5380-b48c-c49dc3697b17",
      version_number: 1,
      title: "Carrot Walnut Snack Cake",
    },
    children: [],
    ingredients: [
      {
        id: "sugar-row",
        ingredient_id: "granulated-sugar",
        canonical_name: "Granulated sugar",
        display_name: "White sugar",
        quantity: "140.0000",
        unit: "g",
        preparation_notes: null,
        display_order: 0,
      },
      {
        id: "black-lime-row",
        ingredient_id: null,
        canonical_name: null,
        display_name: "Black lime powder (house blend)",
        quantity: "1.0000",
        unit: "tsp",
        preparation_notes: "added at the table",
        display_order: 1,
      },
    ],
    instructions: [],
  };
}

beforeEach(() => {
  document.cookie = "recipe_lab_csrf=test-csrf-token; path=/";
});

afterEach(() => {
  document.cookie = "recipe_lab_csrf=; max-age=0; path=/";
  vi.unstubAllGlobals();
});

describe("variant API client", () => {
  it("posts the exact structured fork request and returns the created detail", async () => {
    const created = createdRecipe();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRecipeVariant(
      sourceRecipeVersionId,
      payload,
      idempotencyKey,
    );

    expect(result).toEqual(created);
    expect(result.ingredients[0]).toMatchObject({
      ingredient_id: "granulated-sugar",
      canonical_name: "Granulated sugar",
      display_name: "White sugar",
    });
    expect(result.ingredients[1]).toMatchObject({
      ingredient_id: null,
      canonical_name: null,
      display_name: "Black lime powder (house blend)",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/recipes/29454eba%2F3a4e%3F5380/variants",
      {
        method: "POST",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-CSRF-Token": "test-csrf-token",
        },
        body: JSON.stringify(payload),
        credentials: "same-origin",
      },
    );

    const submitted = JSON.parse(
      String(fetchMock.mock.calls[0][1]?.body),
    ) as Record<string, unknown>;
    expect(submitted.servings).toBe("8.00");
    expect(submitted).not.toHaveProperty("created_by_user_id");
    expect(submitted).not.toHaveProperty("lineage_id");
    expect(submitted).not.toHaveProperty("version_number");
  });

  it("keeps a canonical-name replacement linked in the created response", async () => {
    const canonicalReplacementPayload: RecipeVariantCreateRequest = {
      ...payload,
      ingredient_edits: [
        {
          op: "replace",
          recipe_ingredient_id: "sugar-row",
          ingredient_name: "Granulated sugar",
        },
      ],
    };
    const created = createdRecipe();
    created.ingredients[0] = {
      ...created.ingredients[0],
      ingredient_id: "granulated-sugar",
      canonical_name: "Granulated sugar",
      display_name: "Granulated sugar",
    };
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(created), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await createRecipeVariant(
      sourceRecipeVersionId,
      canonicalReplacementPayload,
      idempotencyKey,
    );

    expect(result.ingredients[0]).toMatchObject({
      ingredient_id: "granulated-sugar",
      canonical_name: "Granulated sugar",
      display_name: "Granulated sugar",
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual(
      canonicalReplacementPayload,
    );
  });

  it("preserves the backend error status, code, and safe message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "invalid_recipe_edits",
              message: "Recipe ingredient edits conflict with the source version.",
              issues: [],
            },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await createRecipeVariant("source-id", payload, idempotencyKey).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(VariantApiError);
    expect(error).toMatchObject({
      status: 422,
      code: "invalid_recipe_edits",
      message: "Recipe ingredient edits conflict with the source version.",
    });
  });

  it("uses a stable fallback for a non-JSON service failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response("upstream gateway details", {
          status: 503,
          headers: { "Content-Type": "text/plain" },
        }),
      ),
    );

    const error = await createRecipeVariant("source-id", payload, idempotencyKey).catch(
      (reason: unknown) => reason,
    );

    expect(error).toBeInstanceOf(VariantApiError);
    expect(error).toMatchObject({
      status: 503,
      code: "variant_api_error",
      message: "The recipe service could not create your version.",
    });
    expect(String(error)).not.toContain("upstream gateway details");
  });
});
