import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useReducer } from "react";
import { vi } from "vitest";

import type { CatalogActionType } from "../../lib/cooking-action-api";
import {
  createDraftIngredientState,
  createDraftInstructionState,
  createStructuredActionDraft,
  type RecipeDraftEditorState,
  type RecipeDraftValidation,
} from "../../lib/recipe-draft";
import {
  initialRecipeDraftPublicationState,
  publicationBlocksDismissal,
  recipeDraftPublicationReducer,
} from "../../lib/recipe-draft-publication-state";
import { createUnspecifiedMeasureDraft } from "../../lib/structured-measure";
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
  const actual =
    await importOriginal<typeof import("../../lib/recipe-duplicate-api")>();
  return { ...actual, createRecipeDraftDuplicatePreflight: mocks.preflight };
});

vi.mock("../../lib/recipe-publication-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/recipe-publication-api")>();
  return { ...actual, publishRecipeDraft: mocks.publish };
});

export const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
export const PREFLIGHT_ID = "22222222-2222-4222-8222-222222222222";
export const RECIPE_ID = "33333333-3333-4333-8333-333333333333";
const INGREDIENT_ID = "44444444-4444-4444-8444-444444444444";
export const SOURCE_ID = "66666666-6666-4666-8666-666666666666";
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
  ingredient.measure = createUnspecifiedMeasureDraft();
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
    totalTimeMinutes: "30",
    activeTimeMinutes: "15",
    difficulty: "easy",
    notes: "Serve immediately.",
    categories: [
      {
        id: "77777777-7777-4777-8777-777777777777",
        name: "Quick & easy",
        slug: "quick-easy",
      },
    ],
    ingredients: [ingredient],
    instructions: [instruction],
  };
}

export function probablePreflight() {
  return {
    classification: "probable_duplicate" as const,
    same_lineage_no_change: false,
    candidates: [
      {
        public_recipe_version_id: RECIPE_ID,
        title: "Public sage recipe",
        classification: "probable_duplicate" as const,
        score: "0.875000",
        reasons: [
          {
            code: "matching_structure",
            message: "The structures are similar.",
          },
        ],
      },
    ],
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

export function directParentNoChangePreflight() {
  return {
    classification: "exact_duplicate" as const,
    same_lineage_no_change: true,
    candidates: [],
    warnings: [
      {
        code: "same_lineage_no_change" as const,
        message:
          "This version has the same canonical structure as its direct parent.",
      },
    ],
    acknowledgement: {
      preflight_id: PREFLIGHT_ID,
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: "b".repeat(64),
      required: true,
      allowed_decisions: ["continue" as const, "revise" as const],
    },
  };
}

export function renderPublication({
  dirty = false,
  draft = completeDraft(),
  onBusyChange = vi.fn(),
  onValidation = vi.fn(),
  sourceRecipeTitle,
  sourceVersionId = null,
}: {
  dirty?: boolean;
  draft?: RecipeDraftEditorState;
  onBusyChange?: (busy: boolean) => void;
  onValidation?: (validation: RecipeDraftValidation) => void;
  sourceRecipeTitle?: string;
  sourceVersionId?: string | null;
} = {}) {
  function PublicationHarness({
    observeBusy,
  }: {
    observeBusy: (busy: boolean) => void;
  }) {
    const [publicationState, publicationDispatch] = useReducer(
      recipeDraftPublicationReducer,
      initialRecipeDraftPublicationState,
    );
    const dismissalBlocked = publicationBlocksDismissal(publicationState);
    useEffect(() => {
      observeBusy(dismissalBlocked);
    }, [dismissalBlocked, observeBusy]);

    return (
      <RecipeDraftPublication
        actionTypes={[actionType]}
        draft={draft}
        draftId={DRAFT_ID}
        dirty={dirty}
        measurementUnits={[]}
        onValidation={onValidation}
        publicationDispatch={publicationDispatch}
        publicationState={publicationState}
        revision={4}
        sourceRecipeTitle={sourceRecipeTitle}
        sourceVersionId={sourceVersionId}
      />
    );
  }

  return render(
    <NavigationBlockerProvider>
      <PublicationHarness observeBusy={onBusyChange} />
    </NavigationBlockerProvider>,
  );
}

export function distinctPreflight() {
  return {
    classification: "distinct" as const,
    same_lineage_no_change: false,
    candidates: [],
    warnings: [],
    acknowledgement: {
      preflight_id: PREFLIGHT_ID,
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: "c".repeat(64),
      required: false,
      allowed_decisions: [],
    },
  };
}

export function confirmPublication() {
  fireEvent.click(
    screen
      .getAllByRole("checkbox", {
        name: /right to share this recipe.*community rules/i,
      })
      .at(-1)!,
  );
}

export function getRecipeDraftPublicationMocks() {
  return mocks;
}

export function resetRecipeDraftPublicationMocks() {
  mocks.preflight.mockReset();
  mocks.publish.mockReset();
  mocks.replace.mockReset();
  mocks.refresh.mockReset();
  mocks.key
    .mockReset()
    .mockReturnValueOnce("preflight-key")
    .mockReturnValueOnce("publish-key");
}

export { AuthApiError } from "../../lib/auth-api";
export { RecipeDuplicateApiError } from "../../lib/recipe-duplicate-api";
export { RecipePublicationApiError } from "../../lib/recipe-publication-api";

