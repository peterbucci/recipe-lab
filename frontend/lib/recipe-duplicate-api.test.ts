import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "./auth-api";
import {
  RecipeDuplicateApiError,
  createRecipeDraftDuplicatePreflight,
  createRecipeDuplicatePreflight,
  parseRecipeDuplicateDecision,
  parseRecipeDuplicatePreflight,
  recordRecipeDuplicateDecision,
  type RecipeDuplicatePreflight,
} from "./recipe-duplicate-api";
import type { RecipeVariantCreateRequest } from "./variant-api";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const PREFLIGHT_ID = "22222222-2222-4222-8222-222222222222";
const CANDIDATE_ID = "33333333-3333-4333-8333-333333333333";
const ACTION_ID = "44444444-4444-4444-8444-444444444444";
const RESULT_DIGEST = "a".repeat(64);

const recipePayload: RecipeVariantCreateRequest = {
  title: "A careful variation",
  description: null,
  servings: "4.00",
  ingredient_edits: [],
  instruction_edits: [],
};

function preflightResponse(
  classification: "exact_duplicate" | "probable_duplicate" | "distinct" =
    "exact_duplicate",
): RecipeDuplicatePreflight {
  const distinct = classification === "distinct";
  return {
    classification,
    same_lineage_no_change: false,
    candidates: distinct
      ? []
      : [
          {
            public_recipe_version_id: CANDIDATE_ID,
            title: "Public candidate",
            classification,
            score: classification === "exact_duplicate" ? "1.000000" : "0.875000",
            reasons: [
              {
                code: "same_curated_ingredient_multiset",
                message: "The curated ingredient set is the same.",
              },
            ],
          },
        ],
    warnings: [],
    acknowledgement: {
      preflight_id: PREFLIGHT_ID,
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: RESULT_DIGEST,
      required: !distinct,
      allowed_decisions: distinct ? [] : ["continue", "revise"],
    },
  };
}

beforeEach(() => {
  document.cookie = "recipe_lab_csrf=test-csrf-token; path=/";
});

afterEach(() => {
  document.cookie = "recipe_lab_csrf=; max-age=0; path=/";
  vi.unstubAllGlobals();
});

describe("recipe duplicate response parsing", () => {
  it.each(["exact_duplicate", "probable_duplicate", "distinct"] as const)(
    "accepts a bounded %s response",
    (classification) => {
      expect(parseRecipeDuplicatePreflight(preflightResponse(classification))).toEqual(
        preflightResponse(classification),
      );
    },
  );

  it("accepts a same-lineage no-change warning with no public candidates", () => {
    const response = preflightResponse("exact_duplicate");
    response.same_lineage_no_change = true;
    response.candidates = [];
    response.warnings = [
      {
        code: "same_lineage_no_change",
        message: "This version keeps the same normalized recipe structure as its parent.",
      },
    ];

    expect(parseRecipeDuplicatePreflight(response)).toEqual(response);
  });

  it.each([
    { name: "unsafe score", change: { score: "1.999999" } },
    { name: "unbounded title", change: { title: "x".repeat(201) } },
    { name: "unsafe recipe identifier", change: { public_recipe_version_id: "../private" } },
    { name: "unexpected field", change: { private_owner_id: SOURCE_ID } },
    { name: "empty reasons", change: { reasons: [] } },
  ])("rejects a malformed candidate: $name", ({ change }) => {
    const response = preflightResponse();
    response.candidates[0] = { ...response.candidates[0], ...change } as never;

    expect(() => parseRecipeDuplicatePreflight(response)).toThrow(
      "invalid similarity review response",
    );
  });

  it("rejects oversized, duplicate, and semantically inconsistent results", () => {
    const oversized = preflightResponse();
    oversized.candidates = Array.from({ length: 6 }, (_, index) => ({
      ...oversized.candidates[0],
      public_recipe_version_id: `${index + 1}3333333-3333-4333-8333-333333333333`,
    }));
    expect(() => parseRecipeDuplicatePreflight(oversized)).toThrow(
      RecipeDuplicateApiError,
    );

    const inconsistent = preflightResponse("distinct");
    inconsistent.acknowledgement.required = true;
    inconsistent.acknowledgement.allowed_decisions = ["continue", "revise"];
    expect(() => parseRecipeDuplicatePreflight(inconsistent)).toThrow(
      RecipeDuplicateApiError,
    );
  });

  it("enforces exact-score and direct-parent invariants", () => {
    const exactScore = preflightResponse("exact_duplicate");
    exactScore.candidates[0]!.score = "0.999900";
    expect(() => parseRecipeDuplicatePreflight(exactScore)).toThrow(
      RecipeDuplicateApiError,
    );

    const probableParentWarning = preflightResponse("probable_duplicate");
    probableParentWarning.same_lineage_no_change = true;
    probableParentWarning.warnings = [
      {
        code: "same_lineage_no_change",
        message: "The structure is unchanged from its direct parent.",
      },
    ];
    expect(() => parseRecipeDuplicatePreflight(probableParentWarning)).toThrow(
      RecipeDuplicateApiError,
    );
  });

  it.each(["1.000000", "0.750000"])(
    "treats probable classification as authoritative at score %s",
    (score) => {
      const probable = preflightResponse("probable_duplicate");
      probable.candidates[0]!.score = score;

      expect(parseRecipeDuplicatePreflight(probable)).toEqual(probable);
    },
  );

  it("requires exact-first, descending-score, UUID-tiebreak candidate order", () => {
    const probable = preflightResponse("probable_duplicate").candidates[0]!;
    const exact = preflightResponse("exact_duplicate").candidates[0]!;
    const wrongClassOrder = preflightResponse("exact_duplicate");
    wrongClassOrder.candidates = [probable, exact];
    expect(() => parseRecipeDuplicatePreflight(wrongClassOrder)).toThrow(
      RecipeDuplicateApiError,
    );

    const wrongScoreOrder = preflightResponse("probable_duplicate");
    wrongScoreOrder.candidates = [
      { ...probable, score: "0.800000" },
      {
        ...probable,
        public_recipe_version_id: "44444444-4444-4444-8444-444444444444",
        score: "0.900000",
      },
    ];
    expect(() => parseRecipeDuplicatePreflight(wrongScoreOrder)).toThrow(
      RecipeDuplicateApiError,
    );

    const wrongUuidOrder = preflightResponse("probable_duplicate");
    wrongUuidOrder.candidates = [
      {
        ...probable,
        public_recipe_version_id: "44444444-4444-4444-8444-444444444444",
      },
      probable,
    ];
    expect(() => parseRecipeDuplicatePreflight(wrongUuidOrder)).toThrow(
      RecipeDuplicateApiError,
    );
  });

  it("rejects permissive non-ISO decision timestamps and unexpected fields", () => {
    expect(() =>
      parseRecipeDuplicateDecision({
        preflight_id: PREFLIGHT_ID,
        decision: "continue",
        recorded_at: "1",
      }),
    ).toThrow(RecipeDuplicateApiError);
    expect(() =>
      parseRecipeDuplicateDecision({
        preflight_id: PREFLIGHT_ID,
        decision: "continue",
        recorded_at: "2026-08-25T12:00:00Z",
        private_owner_id: SOURCE_ID,
      }),
    ).toThrow(RecipeDuplicateApiError);
  });
});

describe("recipe duplicate API client", () => {
  it("checks one saved private draft revision without resubmitting its document", async () => {
    const responsePayload = preflightResponse("probable_duplicate");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json(responsePayload, { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createRecipeDraftDuplicatePreflight(SOURCE_ID, 7, ACTION_ID),
    ).resolves.toEqual(responsePayload);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipe-drafts/${SOURCE_ID}/duplicate-preflights`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ revision: 7 }),
        headers: expect.objectContaining({
          "Idempotency-Key": ACTION_ID,
          "X-CSRF-Token": "test-csrf-token",
        }),
      }),
    );
  });

  it("posts a preflight with member mutation evidence and parses the result", async () => {
    const responsePayload = preflightResponse("probable_duplicate");
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify(responsePayload), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      createRecipeDuplicatePreflight(SOURCE_ID, recipePayload, ACTION_ID),
    ).resolves.toEqual(responsePayload);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipes/${SOURCE_ID}/duplicate-preflights`,
      {
        method: "POST",
        cache: "no-store",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "Idempotency-Key": ACTION_ID,
          "X-CSRF-Token": "test-csrf-token",
        },
        body: JSON.stringify(recipePayload),
      },
    );
  });

  it("posts the acknowledgement decision and verifies its response identity", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          preflight_id: PREFLIGHT_ID,
          decision: "continue",
          recorded_at: "2026-08-25T12:00:00Z",
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const decision = {
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: RESULT_DIGEST,
      decision: "continue" as const,
    };
    await expect(
      recordRecipeDuplicateDecision(PREFLIGHT_ID, decision, ACTION_ID),
    ).resolves.toMatchObject({ preflight_id: PREFLIGHT_ID, decision: "continue" });
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/recipe-duplicate-preflights/${PREFLIGHT_ID}/decision`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(decision),
      }),
    );
  });

  it("uses a generic failure message and announces an expired session", async () => {
    const expired = vi.fn();
    window.addEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "authentication_required",
              message: "Sensitive upstream detail",
            },
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await createRecipeDuplicatePreflight(
      SOURCE_ID,
      recipePayload,
      ACTION_ID,
    ).catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      status: 401,
      code: "authentication_required",
      message: "Your session expired. Sign in again to continue.",
    });
    expect(String(error)).not.toContain("Sensitive upstream detail");
    expect(expired).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_SESSION_EXPIRED_EVENT, expired);
  });

  it("identifies an unavailable fork source without exposing arbitrary server detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: "recipe_fork_source_unavailable",
              message: "Untrusted upstream wording",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const error = await createRecipeDraftDuplicatePreflight(
      SOURCE_ID,
      7,
      ACTION_ID,
    ).catch((reason: unknown) => reason);
    expect(error).toMatchObject({
      status: 409,
      code: "recipe_fork_source_unavailable",
      message: "The public source recipe is no longer available. Your private draft is unchanged.",
    });
    expect(String(error)).not.toContain("Untrusted upstream wording");
  });
});
