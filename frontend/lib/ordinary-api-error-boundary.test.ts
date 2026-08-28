import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "./auth-api";
import {
  searchCatalogIngredients,
  submitMissingIngredientRequest,
} from "./ingredient-catalog-api";
import { createRecipeDraft } from "./recipe-draft-api";
import { createRecipeDraftDuplicatePreflight } from "./recipe-duplicate-api";
import { fetchMyRecipeLibrary } from "./recipe-library-api";
import { publishRecipeDraft } from "./recipe-publication-api";
import { submitRecipeReport } from "./recipe-report-api";
import { updateRecipeVisibility } from "./recipe-visibility-api";

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const INTERNAL_ID = "99999999-9999-4999-8999-999999999999";
const HOSTILE_ERROR = {
  error: {
    code: "internal_operator_policy_failure",
    message: `Canonical UUID ${INTERNAL_ID} failed an operator policy.`,
    issues: [
      {
        location: ["body", INTERNAL_ID],
        message: "Private operator detail.",
        type: "internal_policy_failure",
      },
    ],
  },
};

const cases: Array<{
  fallbackCode: string;
  name: string;
  request: () => Promise<unknown>;
}> = [
  {
    name: "ingredient catalog search",
    fallbackCode: "ingredient_catalog_api_error",
    request: () => searchCatalogIngredients({ query: "tomato" }),
  },
  {
    name: "member ingredient requests",
    fallbackCode: "ingredient_catalog_api_error",
    request: () =>
      submitMissingIngredientRequest({
        proposed_name: "Romanesco",
        context: null,
      }),
  },
  {
    name: "private recipe drafts",
    fallbackCode: "recipe_draft_api_error",
    request: () => createRecipeDraft(null),
  },
  {
    name: "recipe libraries",
    fallbackCode: "recipe_library_api_error",
    request: () => fetchMyRecipeLibrary(),
  },
  {
    name: "recipe publication",
    fallbackCode: "recipe_publication_api_error",
    request: () =>
      publishRecipeDraft(
        DRAFT_ID,
        {
          revision: 1,
          duplicate_review: {
            preflight_id: RECIPE_ID,
            policy_version: "recipe-duplicate-preflight-policy-v1",
            result_digest: "a".repeat(64),
            decision: null,
          },
          community_rules_accepted: true,
          content_rights_confirmed: true,
        },
        "publication-key",
      ),
  },
  {
    name: "recipe reports",
    fallbackCode: "recipe_report_api_error",
    request: () =>
      submitRecipeReport(
        RECIPE_ID,
        { reason: "spam", details: null },
        "report-key",
      ),
  },
  {
    name: "recipe visibility",
    fallbackCode: "recipe_visibility_api_error",
    request: () => updateRecipeVisibility(RECIPE_ID, "author_withdrawn"),
  },
  {
    name: "similar recipe checks",
    fallbackCode: "recipe_duplicate_api_error",
    request: () =>
      createRecipeDraftDuplicatePreflight(DRAFT_ID, 1, "preflight-key"),
  },
];

beforeEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=test-token; Path=/`;
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
});

describe("ordinary API error boundaries", () => {
  it.each(cases)(
    "drops hostile internal codes and messages for $name",
    async ({ fallbackCode, request }) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(Response.json(HOSTILE_ERROR, { status: 503 })),
      );

      const error = await request().catch((reason: unknown) => reason);
      expect(error).toMatchObject({ code: fallbackCode, status: 503 });
      expect(`${String(error)} ${JSON.stringify(error)}`).not.toMatch(
        /99999999|canonical|uuid|operator|policy|internal_/i,
      );
    },
  );
});
