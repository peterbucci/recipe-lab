import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogActionType } from "../../lib/cooking-action-api";
import {
  createDraftIngredientState,
  createDraftInstructionState,
  createStructuredActionDraft,
  type RecipeDraftEditorState,
  type RecipeDraftValidation,
} from "../../lib/recipe-draft";
import { RecipeDuplicateApiError } from "../../lib/recipe-duplicate-api";
import { NavigationBlockerProvider } from "./navigation-blocker-provider";
import { RecipeDraftPublication } from "./recipe-draft-publication";

const mocks = vi.hoisted(() => ({
  preflight: vi.fn(),
  publish: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  key: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: mocks.key,
}));

vi.mock("../../lib/recipe-duplicate-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-duplicate-api")>();
  return { ...actual, createRecipeDraftDuplicatePreflight: mocks.preflight };
});

vi.mock("../../lib/recipe-publication-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-publication-api")>();
  return { ...actual, publishRecipeDraft: mocks.publish };
});

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const PREFLIGHT_ID = "22222222-2222-4222-8222-222222222222";
const RECIPE_ID = "33333333-3333-4333-8333-333333333333";
const INGREDIENT_ID = "44444444-4444-4444-8444-444444444444";
const actionType: CatalogActionType = {
  id: "55555555-5555-4555-8555-555555555555",
  key: "mix",
  canonical_verb: "mix",
  active: true,
  provenance: "Test catalog.",
};

function completeDraft(): RecipeDraftEditorState {
  const ingredient = createDraftIngredientState("ingredient-ref");
  ingredient.selection = {
    kind: "catalog",
    ingredient: {
      ingredientId: INGREDIENT_ID,
      canonicalName: "sage",
      displayName: "Sage",
    },
  };
  const instruction = createDraftInstructionState("instruction-ref");
  instruction.text = "Mix the sage.";
  const action = createStructuredActionDraft("action-ref");
  action.actionType = actionType;
  action.ingredientKeys = [ingredient.key];
  instruction.actions = [action];
  return {
    title: "Sage recipe",
    description: "A complete original.",
    servings: "2",
    ingredients: [ingredient],
    instructions: [instruction],
  };
}

function probablePreflight() {
  return {
    classification: "probable_duplicate" as const,
    same_lineage_no_change: false,
    candidates: [{
      public_recipe_version_id: RECIPE_ID,
      title: "Public sage recipe",
      classification: "probable_duplicate" as const,
      score: "0.875000",
      reasons: [{ code: "matching_structure", message: "The structures are similar." }],
    }],
    warnings: [],
    acknowledgement: {
      preflight_id: PREFLIGHT_ID,
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: "a".repeat(64),
      required: true,
      allowed_decisions: ["continue" as const, "revise" as const],
    },
  };
}

function renderPublication({
  dirty = false,
  draft = completeDraft(),
  onValidation = vi.fn(),
}: {
  dirty?: boolean;
  draft?: RecipeDraftEditorState;
  onValidation?: (validation: RecipeDraftValidation) => void;
} = {}) {
  render(
    <NavigationBlockerProvider>
      <RecipeDraftPublication
        actionTypes={[actionType]}
        draft={draft}
        draftId={DRAFT_ID}
        dirty={dirty}
        measurementUnits={[]}
        onBusyChange={vi.fn()}
        onValidation={onValidation}
        revision={4}
      />
    </NavigationBlockerProvider>,
  );
}

describe("RecipeDraftPublication", () => {
  beforeEach(() => {
    mocks.preflight.mockReset();
    mocks.publish.mockReset();
    mocks.replace.mockReset();
    mocks.refresh.mockReset();
    mocks.key.mockReset().mockReturnValueOnce("preflight-key").mockReturnValueOnce("publish-key");
  });

  it("requires a confirmed save and publication-complete fields before review", async () => {
    renderPublication({ dirty: true });
    expect(screen.getByRole("button", { name: "Review and publish" })).toBeDisabled();
    expect(screen.getByText("Save your latest changes before publishing.")).toBeVisible();

    const onValidation = vi.fn();
    renderPublication({
      draft: { title: "", description: "", servings: "", ingredients: [], instructions: [] },
      onValidation,
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Review and publish" })[1]!);
    expect(onValidation).toHaveBeenCalledWith(expect.objectContaining({ payload: null }));
    expect(mocks.preflight).not.toHaveBeenCalled();
  });

  it("pauses on a probable match and publishes only after explicit acknowledgement", async () => {
    mocks.preflight.mockResolvedValue(probablePreflight());
    mocks.publish.mockResolvedValue({
      recipe_version_id: RECIPE_ID,
      location: `/recipes/${RECIPE_ID}`,
    });
    renderPublication();

    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    await waitFor(() => expect(mocks.preflight).toHaveBeenCalledWith(DRAFT_ID, 4, "preflight-key"));
    const continueButton = await screen.findByRole("button", { name: "Publish recipe anyway" });
    expect(continueButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /publish my recipe anyway/i }));
    expect(continueButton).toBeEnabled();
    fireEvent.click(continueButton);

    await waitFor(() => expect(mocks.publish).toHaveBeenCalledWith(
      DRAFT_ID,
      {
        revision: 4,
        duplicate_review: {
          preflight_id: PREFLIGHT_ID,
          policy_version: "recipe-duplicate-preflight-policy-v1",
          result_digest: "a".repeat(64),
          decision: "continue",
        },
      },
      "publish-key",
    ));
    expect(mocks.replace).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}`);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("offers retry without a publish-without-review escape hatch", async () => {
    mocks.preflight.mockRejectedValue(
      new RecipeDuplicateApiError(
        "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
        503,
        "duplicate_preflight_unavailable",
      ),
    );
    renderPublication();

    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));
    expect(await screen.findByRole("button", { name: "Retry similarity review" })).toBeVisible();
    expect(screen.queryByRole("button", { name: /publish without/i })).toBeNull();
    expect(screen.getByRole("heading", { name: "Publish this original recipe." })).toBeVisible();
  });
});
