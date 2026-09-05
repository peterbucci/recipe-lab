import { render } from "@testing-library/react";
import { vi } from "vitest";

import type { RecipeDetail } from "../../lib/recipe-api";
import type { RecipeDraftDetail } from "../../lib/recipe-draft-api";
import {
  AuthSessionProvider,
  SessionRecoveryNotice,
} from "./auth-session-provider";
import { NavigationBlockerProvider } from "./navigation-blocker-provider";
import { RecipeDraftEditor } from "./recipe-draft-editor";

const mocks = vi.hoisted(() => ({
  discardRecipeDraft: vi.fn(),
  fetchActiveRecipeCategories: vi.fn(),
  fetchRecipeDraft: vi.fn(),
  key: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  updateRecipeDraft: vi.fn(),
}));

export function getRecipeDraftEditorMocks() {
  return mocks;
}

vi.mock("next/navigation", () => ({
  usePathname: () => `/recipes/drafts/${DRAFT_ID}`,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: () => mocks.key(),
}));

vi.mock("../../lib/recipe-draft-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/recipe-draft-api")>();
  return {
    ...actual,
    discardRecipeDraft: mocks.discardRecipeDraft,
    fetchRecipeDraft: mocks.fetchRecipeDraft,
    updateRecipeDraft: mocks.updateRecipeDraft,
  };
});

vi.mock("../../lib/recipe-category-client-api", () => ({
  fetchActiveRecipeCategories: mocks.fetchActiveRecipeCategories,
}));

export const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
export const INGREDIENT_ROW_ID = "22222222-2222-4222-8222-222222222222";
export const ACTION_ID = "33333333-3333-4333-8333-333333333333";
export const CATEGORY_ID = "77777777-7777-4777-8777-777777777777";
export const category = {
  id: CATEGORY_ID,
  name: "Quick & easy",
  slug: "quick-easy",
};
export const detail: RecipeDraftDetail = {
  id: DRAFT_ID,
  source_version_id: null,
  status: "active",
  revision: 3,
  title: "",
  description: null,
  servings: null,
  total_time_minutes: null,
  active_time_minutes: null,
  difficulty: null,
  notes: null,
  categories: [],
  ingredients: [],
  instructions: [],
  created_at: "2026-08-25T12:00:00Z",
  updated_at: "2026-08-25T12:00:00Z",
};

export const detailWithBoundCookingAction: RecipeDraftDetail = {
  ...detail,
  title: "Bound tomato soup",
  servings: "2",
  ingredients: [
    {
      id: INGREDIENT_ROW_ID,
      display_order: 0,
      selection: {
        kind: "catalog",
        ingredient: {
          id: "44444444-4444-4444-8444-444444444444",
          canonical_name: "tomato",
          aliases: [],
        },
        display_name: "Tomato",
      },
      measure: {
        kind: "qualitative",
        value: "as_needed",
        unit: null,
        display_unit: null,
        display: "as needed",
      },
      preparation_notes: null,
    },
  ],
  instructions: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      title: null,
      display_order: 0,
      text: "Stir in the tomato.",
      actions: [
        {
          id: ACTION_ID,
          display_order: 0,
          action_type: {
            id: "66666666-6666-4666-8666-666666666666",
            key: "stir",
            canonical_verb: "stir",
            active: true,
          },
          ingredient_occurrence_ids: [INGREDIENT_ROW_ID],
          duration: null,
          temperature: null,
        },
      ],
    },
  ],
};

export function publicSourceRecipe(
  id: string,
  title = "Public tomato soup",
): RecipeDetail {
  return {
    id,
    lineage_id: "33333333-3333-4333-8333-333333333333",
    parent_version_id: null,
    version_number: 1,
    title,
    description: "The public source recipe.",
    servings: "2",
    created_at: "2026-08-20T12:00:00Z",
    published_at: "2026-08-20T12:00:00Z",
    author: {
      id: "source-author",
      display_name: "Source Cook",
      handle: "source-cook",
    },
    parent: null,
    categories: [],
    average_rating: null,
    rating_count: 0,
    save_count: 0,
    total_time_minutes: null,
    active_time_minutes: null,
    difficulty: null,
    notes: null,
    viewer_state: null,
    children: [],
    ingredients: [],
    instructions: [],
  };
}

export function renderEditor(
  initialDetail?: RecipeDraftDetail,
  onDoneForNow?: () => void,
  familyRecipe?: RecipeDetail,
  embedded = false,
) {
  return render(
    <NavigationBlockerProvider>
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "member", display_name: "Member", handle: "member" },
        }}
      >
        <SessionRecoveryNotice />
        <RecipeDraftEditor
          draftId={DRAFT_ID}
          embedded={embedded}
          familyRecipe={familyRecipe}
          familyVersions={familyRecipe ? [] : undefined}
          initialCategories={initialDetail === undefined ? undefined : []}
          initialDetail={initialDetail}
          measurementUnits={[]}
          onDoneForNow={onDoneForNow}
          actionTypes={[]}
        />
      </AuthSessionProvider>
    </NavigationBlockerProvider>,
  );
}

export function resetRecipeDraftEditorMocks() {
  Element.prototype.scrollIntoView = vi.fn();
  mocks.discardRecipeDraft.mockReset().mockResolvedValue(undefined);
  mocks.fetchActiveRecipeCategories.mockReset().mockResolvedValue({
    items: [category],
  });
  mocks.fetchRecipeDraft.mockReset().mockResolvedValue(detail);
  mocks.key.mockReset().mockReturnValue("draft-save-key");
  mocks.updateRecipeDraft.mockReset();
  mocks.refresh.mockReset();
  mocks.replace.mockReset();
}

export function cleanupRecipeDraftEditorMocks() {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
}

export { RecipeDraftApiError } from "../../lib/recipe-draft-api";
