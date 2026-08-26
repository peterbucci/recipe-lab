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
import { RecipePublicationApiError } from "../../lib/recipe-publication-api";
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
const SOURCE_ID = "66666666-6666-4666-8666-666666666666";
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

function directParentNoChangePreflight() {
  return {
    classification: "exact_duplicate" as const,
    same_lineage_no_change: true,
    candidates: [],
    warnings: [{
      code: "same_lineage_no_change" as const,
      message: "This version has the same canonical structure as its direct parent.",
    }],
    acknowledgement: {
      preflight_id: PREFLIGHT_ID,
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: "b".repeat(64),
      required: true,
      allowed_decisions: ["continue" as const, "revise" as const],
    },
  };
}

function renderPublication({
  dirty = false,
  draft = completeDraft(),
  onValidation = vi.fn(),
  sourceVersionId = null,
}: {
  dirty?: boolean;
  draft?: RecipeDraftEditorState;
  onValidation?: (validation: RecipeDraftValidation) => void;
  sourceVersionId?: string | null;
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
        sourceVersionId={sourceVersionId}
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
    expect(screen.getByText(/published snapshots and their recipe lineage stay public/i)).toHaveTextContent(
      /Deleted cook.*withdraw/i,
    );

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

  it("requires an explicit direct-parent no-change decision before publishing a fork", async () => {
    mocks.preflight.mockResolvedValue(directParentNoChangePreflight());
    mocks.publish.mockResolvedValue({
      recipe_version_id: RECIPE_ID,
      location: `/recipes/${RECIPE_ID}`,
    });
    renderPublication({ sourceVersionId: SOURCE_ID });

    expect(
      screen.getByRole("heading", { name: "Publish your version without changing its source." }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Review and publish version" }));

    const acknowledgement = await screen.findByRole("checkbox", {
      name: /direct-parent no-change warning/i,
    });
    expect(screen.getByText(/same canonical structure as its direct parent/i)).toBeVisible();
    const publishAnyway = screen.getByRole("button", { name: "Publish version anyway" });
    expect(publishAnyway).toBeDisabled();
    fireEvent.click(acknowledgement);
    fireEvent.click(publishAnyway);

    await waitFor(() =>
      expect(mocks.publish).toHaveBeenCalledWith(
        DRAFT_ID,
        {
          revision: 4,
          duplicate_review: {
            preflight_id: PREFLIGHT_ID,
            policy_version: "recipe-duplicate-preflight-policy-v1",
            result_digest: "b".repeat(64),
            decision: "continue",
          },
        },
        "publish-key",
      ),
    );
    expect(mocks.replace).toHaveBeenCalledWith(`/recipes/${RECIPE_ID}`);
  });

  it("keeps a fork draft in place when its source becomes unavailable", async () => {
    mocks.preflight.mockResolvedValue(directParentNoChangePreflight());
    mocks.publish.mockRejectedValue(
      new RecipePublicationApiError(
        "The public source recipe is no longer available. Your private draft is unchanged.",
        409,
        "recipe_fork_source_unavailable",
      ),
    );
    renderPublication({ sourceVersionId: SOURCE_ID });

    fireEvent.click(screen.getByRole("button", { name: "Review and publish version" }));
    fireEvent.click(await screen.findByRole("checkbox", { name: /direct-parent no-change warning/i }));
    fireEvent.click(screen.getByRole("button", { name: "Publish version anyway" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The public source recipe is no longer available. Your private draft is unchanged.",
    );
    expect(screen.getByRole("button", { name: "Check source and retry" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Check source page" })).toHaveAttribute(
      "href",
      `/recipes/${SOURCE_ID}`,
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Publish your version without changing its source." })).toBeVisible();
  });
});
