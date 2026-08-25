import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  CatalogIngredientPage,
  MemberIngredientRequest,
  MemberIngredientRequestPage,
} from "../../lib/ingredient-catalog-api";
import type { CatalogActionType } from "../../lib/cooking-action-api";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import type { RecipeDetail } from "../../lib/recipe-api";
import {
  createRecipeDuplicatePreflight,
  RecipeDuplicateApiError,
  recordRecipeDuplicateDecision,
  type RecipeDuplicatePreflight,
} from "../../lib/recipe-duplicate-api";
import { createRecipeVariant, VariantApiError } from "../../lib/variant-api";
import { RecipeVariantEditor } from "./recipe-variant-editor";

const mocks = vi.hoisted(() => ({
  browseMyIngredientRequests: vi.fn(),
  createRecipeDuplicatePreflight: vi.fn(),
  createIdempotencyKey: vi.fn(),
  createRecipeVariant: vi.fn(),
  fetchMyIngredientRequest: vi.fn(),
  recordRecipeDuplicateDecision: vi.fn(),
  replace: vi.fn(),
  searchCatalogIngredients: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("../../lib/variant-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/variant-api")>();
  return {
    ...actual,
    createRecipeVariant: mocks.createRecipeVariant,
  };
});

vi.mock("../../lib/recipe-duplicate-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-duplicate-api")>();
  return {
    ...actual,
    createRecipeDuplicatePreflight: mocks.createRecipeDuplicatePreflight,
    recordRecipeDuplicateDecision: mocks.recordRecipeDuplicateDecision,
  };
});

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: mocks.createIdempotencyKey,
}));

vi.mock("../../lib/ingredient-catalog-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/ingredient-catalog-api")>();
  return {
    ...actual,
    browseMyIngredientRequests: mocks.browseMyIngredientRequests,
    fetchMyIngredientRequest: mocks.fetchMyIngredientRequest,
    searchCatalogIngredients: mocks.searchCatalogIngredients,
  };
});

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SECOND_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const THIRD_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const FOURTH_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
const FIFTH_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa7";
const PREFLIGHT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
const CANDIDATE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa6";
const SUGAR_ID = "44444444-4444-4444-8444-444444444444";
const WALNUT_ID = "55555555-5555-4555-8555-555555555555";
const SALT_ID = "66666666-6666-4666-8666-666666666666";
const PECAN_ID = "77777777-7777-4777-8777-777777777777";
const ORANGE_ZEST_ID = "88888888-8888-4888-8888-888888888888";
const REQUEST_ID = "99999999-9999-4999-8999-999999999999";
const GRAM_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CUP_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const TABLESPOON_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3";
const CAN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4";
const PACKAGE_SIZE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const MIX_ACTION_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const FOLD_ACTION_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const BAKE_ACTION_ID = "dddddddd-dddd-4ddd-8ddd-ddddddddddd3";

const actionTypes: CatalogActionType[] = [
  {
    id: MIX_ACTION_ID,
    key: "mix",
    canonical_verb: "mix",
    active: true,
    provenance: "Test fixture",
  },
  {
    id: FOLD_ACTION_ID,
    key: "fold",
    canonical_verb: "fold",
    active: true,
    provenance: "Test fixture",
  },
  {
    id: BAKE_ACTION_ID,
    key: "bake",
    canonical_verb: "bake",
    active: true,
    provenance: "Test fixture",
  },
];

function action(
  id: string,
  type: CatalogActionType,
  ingredientOccurrenceIds: string[] = [],
) {
  return {
    id,
    action_type: {
      id: type.id,
      key: type.key,
      canonical_verb: type.canonical_verb,
      active: type.active,
    },
    display_order: 0,
    ingredient_occurrence_ids: ingredientOccurrenceIds,
    duration: null,
    temperature: null,
  };
}

const measurementUnits: CatalogUnit[] = [
  {
    id: GRAM_ID,
    key: "gram",
    dimension: "mass",
    canonical_label: "gram",
    plural_label: "grams",
    symbol: "g",
    display_style: "symbol",
    aliases: ["gram", "grams"],
    active: true,
    provenance: "Test fixture",
  },
  {
    id: CUP_ID,
    key: "cup",
    dimension: "volume",
    canonical_label: "cup",
    plural_label: "cups",
    symbol: null,
    display_style: "word",
    aliases: ["cup", "cups"],
    active: true,
    provenance: "Test fixture",
  },
  {
    id: TABLESPOON_ID,
    key: "tablespoon",
    dimension: "volume",
    canonical_label: "tablespoon",
    plural_label: "tablespoons",
    symbol: "tbsp",
    display_style: "symbol",
    aliases: ["tablespoon"],
    active: true,
    provenance: "Test fixture",
  },
  {
    id: CAN_ID,
    key: "can",
    dimension: "package",
    canonical_label: "can",
    plural_label: "cans",
    symbol: null,
    display_style: "word",
    aliases: ["can", "cans"],
    active: true,
    provenance: "Test fixture",
  },
];

const gramSummary = {
  id: GRAM_ID,
  key: "gram",
  dimension: "mass" as const,
  canonical_label: "gram",
  plural_label: "grams",
  symbol: "g",
  display_style: "symbol" as const,
  active: true,
};

const canSummary = {
  id: CAN_ID,
  key: "can",
  dimension: "package" as const,
  canonical_label: "can",
  plural_label: "cans",
  symbol: null,
  display_style: "word" as const,
  active: true,
};

function resolvedRequest(): MemberIngredientRequest {
  return {
    id: REQUEST_ID,
    proposed_name: "Pecan nut request text",
    context: "For carrot cake",
    status: "duplicate",
    created_at: "2026-08-24T18:00:00Z",
    reviewed_at: "2026-08-24T19:00:00Z",
    decision_reason: "Already cataloged as Pecan.",
    resolved_ingredient_id: PECAN_ID,
    resolved_ingredient: {
      id: PECAN_ID,
      canonical_name: "Pecan",
      aliases: ["Pecan nut"],
    },
  };
}

function resolvedRequestPage(): MemberIngredientRequestPage {
  return {
    items: [resolvedRequest()],
    page: 1,
    page_size: 10,
    total: 1,
    total_pages: 1,
  };
}

function sourceRecipe(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    id: SOURCE_ID,
    lineage_id: "33333333-3333-4333-8333-333333333333",
    parent_version_id: null,
    version_number: 1,
    title: "Carrot Walnut Snack Cake",
    description: "A softly spiced snack cake.",
    servings: "8.00",
    created_at: "2026-08-20T00:00:00Z",
    average_rating: 4.5,
    rating_count: 2,
    viewer_state: {
      recipe_version_id: SOURCE_ID,
      saved: false,
      rating: null,
    },
    parent: null,
    children: [],
    ingredients: [
      {
        id: "sugar-row",
        ingredient_id: SUGAR_ID,
        canonical_name: "Granulated sugar",
        display_name: "White sugar",
        measure: {
          kind: "exact",
          value: "180.0000",
          unit: gramSummary,
          display_unit: "g",
          display: "180 g",
        },
        preparation_notes: null,
        display_order: 0,
      },
      {
        id: "walnut-row",
        ingredient_id: WALNUT_ID,
        canonical_name: "Walnut",
        display_name: "Walnuts",
        measure: {
          kind: "exact",
          value: "100.0000",
          unit: gramSummary,
          display_unit: "g",
          display: "100 g",
        },
        preparation_notes: "roughly chopped",
        display_order: 1,
      },
      {
        id: "salt-row",
        ingredient_id: SALT_ID,
        canonical_name: "Salt",
        display_name: "Salt",
        measure: {
          kind: "qualitative",
          value: "unspecified",
          unit: null,
          display_unit: null,
          display: "Amount not specified",
        },
        preparation_notes: null,
        display_order: 2,
      },
    ],
    instructions: [
      {
        id: "mix-step",
        text: "Whisk the dry ingredients.",
        display_order: 0,
        actions: [action("mix-action", actionTypes[0], ["sugar-row"])],
      },
      {
        id: "fold-step",
        text: "Fold in the carrots and walnuts.",
        display_order: 1,
        actions: [action("fold-action", actionTypes[1], ["walnut-row"])],
      },
      {
        id: "bake-step",
        text: "Bake until springy.",
        display_order: 2,
        actions: [action("bake-action", actionTypes[2])],
      },
    ],
    ...overrides,
  };
}

function createdRecipe(): RecipeDetail {
  return {
    ...sourceRecipe(),
    id: CHILD_ID,
    parent_version_id: SOURCE_ID,
    version_number: 2,
    title: "Orange Pecan Carrot Cake",
    viewer_state: {
      recipe_version_id: CHILD_ID,
      saved: false,
      rating: null,
    },
    parent: {
      id: SOURCE_ID,
      version_number: 1,
      title: "Carrot Walnut Snack Cake",
    },
  };
}

function duplicatePreflight(
  classification: "exact_duplicate" | "probable_duplicate" | "distinct" = "distinct",
  overrides: Partial<RecipeDuplicatePreflight> = {},
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
            title: "Public carrot cake candidate",
            classification,
            score: classification === "exact_duplicate" ? "1.000000" : "0.850000",
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
      result_digest: "a".repeat(64),
      required: !distinct,
      allowed_decisions: distinct ? [] : ["continue", "revise"],
    },
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function instructionRow(stepNumber: number): HTMLElement {
  const stepLabel = screen.getByText(`Step ${stepNumber}`, {
    selector: "strong",
  });
  const row = stepLabel.closest("li");

  if (!row) {
    throw new Error(`Could not find the row for step ${stepNumber}.`);
  }

  return row;
}

function expandIngredientRow(row: HTMLElement, name: string): void {
  const changeButton = within(row).queryByRole("button", {
    name: `Change ${name}`,
  });
  if (changeButton) {
    fireEvent.click(changeButton);
  }
}

function catalogPage(
  id: string,
  canonicalName: string,
  aliases: string[] = [],
): CatalogIngredientPage {
  return {
    items: [{ id, canonical_name: canonicalName, aliases }],
    page: 1,
    page_size: 20,
    total: 1,
    total_pages: 1,
  };
}

async function chooseCatalogIngredient(
  row: HTMLElement,
  inputName: RegExp,
  query: string,
  resultName: RegExp,
) {
  const search = within(row).getByRole("searchbox", { name: inputName });
  fireEvent.change(search, { target: { value: query } });
  fireEvent.click(within(row).getByRole("button", { name: "Search catalog" }));
  const result = await within(row).findByRole("button", { name: resultName });
  fireEvent.click(result);
}

function expandInstructionRow(stepNumber: number): HTMLElement {
  const row = instructionRow(stepNumber);
  const editButton = within(row).queryByRole("button", {
    name: `Edit step ${stepNumber}`,
  });
  if (editButton) {
    fireEvent.click(editButton);
  }
  return row;
}

function instructionInput(stepNumber: number): HTMLTextAreaElement {
  return within(expandInstructionRow(stepNumber)).getByRole("textbox", {
    name: /^instruction$/i,
  });
}

function packagedSourceRecipe(): RecipeDetail {
  const recipe = sourceRecipe();
  recipe.ingredients[0].measure = {
    kind: "exact",
    value: "2.0000",
    unit: canSummary,
    package_size_id: PACKAGE_SIZE_ID,
    display_unit: "cans",
    display: "2 cans",
  };
  return recipe;
}

function renderEditor(recipe = sourceRecipe()) {
  return render(
    <RecipeVariantEditor
      sourceRecipe={recipe}
      measurementUnits={measurementUnits}
      actionTypes={actionTypes}
    />,
  );
}

beforeEach(() => {
  mocks.browseMyIngredientRequests.mockReset();
  mocks.replace.mockReset();
  mocks.createRecipeDuplicatePreflight.mockReset();
  mocks.recordRecipeDuplicateDecision.mockReset();
  mocks.createRecipeVariant.mockReset();
  mocks.createIdempotencyKey.mockReset();
  mocks.searchCatalogIngredients.mockReset();
  mocks.fetchMyIngredientRequest.mockReset();
  mocks.browseMyIngredientRequests.mockResolvedValue(resolvedRequestPage());
  mocks.fetchMyIngredientRequest.mockResolvedValue(resolvedRequest());
  mocks.createRecipeDuplicatePreflight.mockResolvedValue(duplicatePreflight());
  mocks.recordRecipeDuplicateDecision.mockImplementation(
    async (_preflightId: string, payload: { decision: "continue" | "revise" }) => ({
      preflight_id: PREFLIGHT_ID,
      decision: payload.decision,
      recorded_at: "2026-08-25T12:00:00Z",
    }),
  );
  mocks.searchCatalogIngredients.mockImplementation(
    async ({ query }: { query?: string }) => {
      if (query?.trim().toLocaleLowerCase() === "orange zest") {
        return catalogPage(ORANGE_ZEST_ID, "Orange zest");
      }
      return catalogPage(PECAN_ID, "Pecan", ["Pecan nut"]);
    },
  );
  mocks.createIdempotencyKey
    .mockReturnValueOnce(FIRST_KEY)
    .mockReturnValueOnce(SECOND_KEY)
    .mockReturnValueOnce(THIRD_KEY)
    .mockReturnValueOnce(FOURTH_KEY)
    .mockReturnValueOnce(FIFTH_KEY);
});

describe("RecipeVariantEditor", () => {
  it("prefills accessible exact and qualitative structured amounts", () => {
    renderEditor();

    const form = screen.getByRole("form", {
      name: /make carrot walnut snack cake your own/i,
    });
    expect(
      within(form).getByRole("group", { name: /about your version/i }),
    ).toBeInTheDocument();
    expect(within(form).getByRole("group", { name: /^ingredients$/i })).toBeInTheDocument();
    expect(within(form).getByRole("group", { name: /^instructions$/i })).toBeInTheDocument();
    expect(
      within(form).getByText(/every numeric unit from the curated catalog/i),
    ).toBeInTheDocument();
    expect(within(form).getByLabelText(/^title$/i)).toHaveValue(
      "Carrot Walnut Snack Cake variation",
    );
    expect(within(form).getByLabelText(/^description$/i)).toHaveValue(
      "A softly spiced snack cake.",
    );
    expect(within(form).getByLabelText(/^servings$/i)).toHaveValue("8.00");
    expect(within(form).getByLabelText(/^servings$/i)).toHaveAttribute(
      "inputmode",
      "decimal",
    );

    const sugar = within(form).getByRole("group", {
      name: "Ingredient 1: White sugar",
    });
    expect(within(sugar).getByText("White sugar · 180 g")).toBeInTheDocument();
    expect(within(sugar).getByText("Starting ingredient")).toBeInTheDocument();
    expect(within(sugar).getByText(/catalog name: granulated sugar/i)).toBeInTheDocument();
    const changeSugar = within(sugar).getByRole("button", {
      name: "Change White sugar",
    });
    expect(changeSugar).toHaveAttribute("aria-expanded", "false");
    expect(within(sugar).queryByLabelText(/^amount$/i)).not.toBeInTheDocument();
    fireEvent.click(changeSugar);
    expect(
      within(sugar).getByRole("button", {
        name: "Done editing White sugar",
      }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(within(sugar).getByRole("searchbox", { name: /swap ingredient/i })).toHaveValue("");
    expect(
      within(sugar).getByRole("group", {
        name: "Amount for Ingredient 1: White sugar",
      }),
    ).toBeInTheDocument();
    expect(within(sugar).getByRole("radio", { name: "Exact" })).toBeChecked();
    expect(within(sugar).getByLabelText(/^amount$/i)).toHaveValue("180.0000");
    expect(within(sugar).getByLabelText(/^amount$/i)).toHaveAttribute(
      "inputmode",
      "decimal",
    );
    expect(within(sugar).getByLabelText(/^unit$/i)).toHaveValue(GRAM_ID);

    const salt = within(form).getByRole("group", { name: /ingredient 3/i });
    expandIngredientRow(salt, "Salt");
    expect(within(salt).getByRole("radio", { name: "Unspecified" })).toBeChecked();
    expect(within(salt).queryByLabelText(/^amount$/i)).not.toBeInTheDocument();
    expect(within(salt).queryByLabelText(/^unit$/i)).not.toBeInTheDocument();
    const firstStep = instructionRow(1);
    const editFirstStep = within(firstStep).getByRole("button", {
      name: "Edit step 1",
    });
    expect(editFirstStep).toHaveAttribute("aria-expanded", "false");
    expect(within(firstStep).queryByRole("textbox")).not.toBeInTheDocument();
    fireEvent.click(editFirstStep);
    expect(
      within(firstStep).getByRole("button", {
        name: "Done editing step 1",
      }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(instructionInput(1)).toHaveValue(
      "Whisk the dry ingredients.",
    );
    expect(within(instructionRow(1)).getByText("Starting step")).toBeInTheDocument();
    expect(within(form).getByRole("link", { name: /^cancel$/i })).toHaveAttribute(
      "href",
      `/recipes/${SOURCE_ID}`,
    );
  });

  it("moves focus into added rows and preserves it across remove and undo", () => {
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /add ingredient/i }));
    const addedIngredient = screen.getByRole("group", {
      name: "New ingredient 4",
    });
    expect(within(addedIngredient).getByRole("searchbox", { name: /^ingredient$/i })).toHaveFocus();
    expect(within(addedIngredient).getByText("New")).toBeInTheDocument();

    fireEvent.click(
      within(addedIngredient).getByRole("button", { name: /remove new ingredient 4/i }),
    );
    const undoIngredient = within(addedIngredient).getByRole("button", {
      name: /undo removal of new ingredient 4/i,
    });
    expect(undoIngredient).toHaveFocus();
    fireEvent.click(undoIngredient);
    expect(
      within(addedIngredient).getByRole("button", { name: /remove new ingredient 4/i }),
    ).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: /add instruction/i }));
    const newStep = instructionInput(4);
    expect(newStep).toHaveFocus();
    expect(within(instructionRow(4)).getByText("New")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /remove step 4/i }));
    const undoStep = screen.getByRole("button", {
      name: /undo removal of step 4/i,
    });
    expect(undoStep).toHaveFocus();
    fireEvent.click(undoStep);
    expect(screen.getByRole("button", { name: /remove step 4/i })).toHaveFocus();
  });

  it("warns before leaving after the cook changes the draft", () => {
    renderEditor();

    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "My carrot cake" },
    });

    expect(screen.getByRole("status")).toHaveTextContent(/you have unsaved changes/i);
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(true);
  });

  it("keeps the leave warning through preflight, decision, and creation until navigation", async () => {
    const preflightRequest = deferred<RecipeDuplicatePreflight>();
    const decisionRequest = deferred<{
      preflight_id: string;
      decision: "continue";
      recorded_at: string;
    }>();
    const variantRequest = deferred<RecipeDetail>();
    vi.mocked(createRecipeDuplicatePreflight).mockReturnValue(preflightRequest.promise);
    vi.mocked(recordRecipeDuplicateDecision).mockReturnValue(decisionRequest.promise);
    vi.mocked(createRecipeVariant).mockReturnValue(variantRequest.promise);
    renderEditor();

    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "Protect this draft while requests are pending" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await waitFor(() => expect(createRecipeDuplicatePreflight).toHaveBeenCalledOnce());

    const duringPreflight = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(duringPreflight);
    expect(duringPreflight.defaultPrevented).toBe(true);

    await act(async () => {
      preflightRequest.resolve(duplicatePreflight("probable_duplicate"));
      await preflightRequest.promise;
    });
    await screen.findByRole("heading", { name: "Review similar recipe structures" });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /reviewed these advisory results/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create my version anyway" }));
    await waitFor(() => expect(recordRecipeDuplicateDecision).toHaveBeenCalledOnce());

    const duringDecision = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(duringDecision);
    expect(duringDecision.defaultPrevented).toBe(true);

    await act(async () => {
      decisionRequest.resolve({
        preflight_id: PREFLIGHT_ID,
        decision: "continue",
        recorded_at: "2026-08-25T12:00:00Z",
      });
      await decisionRequest.promise;
    });
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());

    const duringCreation = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(duringCreation);
    expect(duringCreation.defaultPrevented).toBe(true);

    await act(async () => {
      variantRequest.resolve(createdRecipe());
      await variantRequest.promise;
    });
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledOnce());

    const afterSuccessfulCreation = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(afterSuccessfulCreation);
    expect(afterSuccessfulCreation.defaultPrevented).toBe(false);
  });

  it("clears the leave warning when only inactive measurement fields differ", () => {
    renderEditor();

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    fireEvent.click(within(sugar).getByRole("button", { name: /change white sugar/i }));
    fireEvent.click(within(sugar).getByRole("radio", { name: "Range" }));
    fireEvent.change(within(sugar).getByLabelText(/minimum amount/i), {
      target: { value: "1" },
    });
    fireEvent.change(within(sugar).getByLabelText(/maximum amount/i), {
      target: { value: "2" },
    });
    fireEvent.click(within(sugar).getByRole("radio", { name: "Exact" }));

    expect(within(sugar).getByText("Starting ingredient")).toBeInTheDocument();
    expect(screen.queryByText(/you have unsaved changes/i)).not.toBeInTheDocument();
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(false);
  });

  it("treats numerically equivalent exact values as unchanged", () => {
    renderEditor();

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    expandIngredientRow(sugar, "White sugar");
    fireEvent.change(within(sugar).getByLabelText(/^amount$/i), {
      target: { value: "180" },
    });

    expect(within(sugar).getByText("Starting ingredient")).toBeInTheDocument();
    expect(screen.queryByText(/you have unsaved changes/i)).not.toBeInTheDocument();
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(false);
  });

  it("treats numerically equivalent range bounds as unchanged", () => {
    const recipe = sourceRecipe();
    recipe.ingredients[0].measure = {
      kind: "range",
      minimum: "1.0000",
      maximum: "2.0000",
      unit: gramSummary,
      display_unit: "g",
      display: "1–2 g",
    };
    renderEditor(recipe);

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    expandIngredientRow(sugar, "White sugar");
    fireEvent.change(within(sugar).getByLabelText(/minimum amount/i), {
      target: { value: "1" },
    });
    fireEvent.change(within(sugar).getByLabelText(/maximum amount/i), {
      target: { value: "2" },
    });

    expect(within(sugar).getByText("Starting ingredient")).toBeInTheDocument();
    expect(screen.queryByText(/you have unsaved changes/i)).not.toBeInTheDocument();
    const beforeUnload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnload);
    expect(beforeUnload.defaultPrevented).toBe(false);
  });

  it("clears inherited package metadata when the ingredient selection changes", async () => {
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor(packagedSourceRecipe());

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    expandIngredientRow(sugar, "White sugar");
    await chooseCatalogIngredient(
      sugar,
      /swap ingredient/i,
      "Pecan",
      /pecan.*also known as/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.objectContaining({
        ingredient_edits: [
          {
            op: "replace",
            recipe_ingredient_id: "sugar-row",
            ingredient_id: PECAN_ID,
            display_name: "Pecan",
          },
          {
            op: "set_measure",
            recipe_ingredient_id: "sugar-row",
            measure: {
              kind: "exact",
              value: "2.0000",
              unit_id: CAN_ID,
            },
          },
        ],
      }),
      SECOND_KEY,
    );
    const submittedPayload = vi.mocked(createRecipeVariant).mock.calls[0]?.[1];
    expect(JSON.stringify(submittedPayload)).not.toContain(PACKAGE_SIZE_ID);
  });

  it("restores inherited package metadata when a replacement is reverted", async () => {
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor(packagedSourceRecipe());

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    expandIngredientRow(sugar, "White sugar");
    await chooseCatalogIngredient(
      sugar,
      /swap ingredient/i,
      "Pecan",
      /pecan.*also known as/i,
    );
    fireEvent.click(within(sugar).getByRole("button", { name: "Clear selection" }));

    expect(within(sugar).getByText("Starting ingredient")).toBeInTheDocument();
    expect(screen.queryByText(/you have unsaved changes/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.objectContaining({ ingredient_edits: [] }),
      SECOND_KEY,
    );
  });

  it("restores inherited package metadata when the original unit is reselected", async () => {
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor(packagedSourceRecipe());

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    expandIngredientRow(sugar, "White sugar");
    const unit = within(sugar).getByLabelText(/^unit$/i);
    fireEvent.change(unit, { target: { value: GRAM_ID } });
    expect(within(sugar).getByText("Changed")).toBeInTheDocument();
    fireEvent.change(unit, { target: { value: CAN_ID } });

    expect(within(sugar).getByText("Starting ingredient")).toBeInTheDocument();
    expect(screen.queryByText(/you have unsaved changes/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.objectContaining({ ingredient_edits: [] }),
      SECOND_KEY,
    );
  });

  it("reopens a compact row when validation finds an error inside it", async () => {
    renderEditor();

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    fireEvent.click(within(sugar).getByRole("button", { name: /change white sugar/i }));
    fireEvent.change(within(sugar).getByLabelText(/^amount$/i), {
      target: { value: "not a number" },
    });
    fireEvent.click(
      within(sugar).getByRole("button", { name: /done editing white sugar/i }),
    );
    expect(within(sugar).queryByLabelText(/^amount$/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

    await waitFor(() =>
      expect(within(sugar).getByLabelText(/^amount$/i)).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(
      screen
        .getByRole("heading", { name: /check your version before creating it/i })
        .closest("div"),
    ).toHaveFocus();
  });

  it("preserves step prose and structured action state after leaf validation fails", async () => {
    renderEditor();

    const step = expandInstructionRow(1);
    const prose = within(step).getByRole("textbox", { name: "Instruction" });
    fireEvent.change(prose, {
      target: { value: "Keep this carefully authored prose." },
    });
    const actionType = within(step).getByRole("combobox", {
      name: "Cooking action",
    });
    fireEvent.change(actionType, { target: { value: "" } });
    fireEvent.click(
      within(step).getByRole("button", { name: "Done editing step 1" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

    await waitFor(() =>
      expect(within(step).getByRole("combobox", { name: "Cooking action" })).toHaveAttribute(
        "aria-invalid",
        "true",
      ),
    );
    expect(within(step).getByRole("textbox", { name: "Instruction" })).toHaveValue(
      "Keep this carefully authored prose.",
    );
    expect(within(step).getByText("Choose a cooking action.")).toBeInTheDocument();
    expect(createRecipeVariant).not.toHaveBeenCalled();
  });

  it("clears a removed-input error when its ingredient occurrence is restored", async () => {
    renderEditor();

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    expandIngredientRow(sugar, "White sugar");
    fireEvent.click(within(sugar).getByRole("button", { name: /remove white sugar/i }));
    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

    const step = instructionRow(1);
    await waitFor(() =>
      expect(within(step).getByText(/restore the removed ingredient/i)).toBeInTheDocument(),
    );

    fireEvent.click(within(sugar).getByRole("button", { name: /undo removal/i }));
    expect(within(step).queryByText(/restore the removed ingredient/i)).toBeNull();
    expect(
      screen.queryByRole("heading", { name: /check your version before creating it/i }),
    ).toBeNull();
  });

  it("submits the exact mixed edit payload after add, remove, and undo interactions", async () => {
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor();

    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "  Orange Pecan Carrot Cake  " },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "   " },
    });

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    expandIngredientRow(sugar, "White sugar");
    fireEvent.change(within(sugar).getByLabelText(/^amount$/i), {
      target: { value: "140.0000" },
    });
    fireEvent.change(within(sugar).getByLabelText(/^unit$/i), {
      target: { value: CUP_ID },
    });
    expect(within(sugar).getByText("White sugar · 140 cups")).toBeInTheDocument();
    expect(
      within(sugar).getByText(
        "Before: White sugar · 180 g → Now: White sugar · 140 cups",
      ),
    ).toBeInTheDocument();

    const walnuts = screen.getByRole("group", { name: /ingredient 2/i });
    expandIngredientRow(walnuts, "Walnuts");
    await chooseCatalogIngredient(
      walnuts,
      /swap ingredient/i,
      "Pecan",
      /pecan.*also known as/i,
    );
    expect(within(walnuts).getByText("Changed")).toBeInTheDocument();
    expect(within(walnuts).getByText("Pecan · 100 g")).toBeInTheDocument();
    expect(
      within(walnuts).getByText(
        "Before: Walnuts · 100 g → Now: Pecan · 100 g",
      ),
    ).toBeInTheDocument();
    expect(within(walnuts).queryByText(/catalog name: walnut/i)).not.toBeInTheDocument();

    const salt = screen.getByRole("group", { name: /ingredient 3/i });
    expandIngredientRow(salt, "Salt");
    fireEvent.click(within(salt).getByRole("button", { name: /remove salt/i }));
    expect(
      within(salt).getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent === "Salt will not be included in your version.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(salt).getByRole("button", { name: /undo removal/i }));
    expect(within(salt).getByRole("radio", { name: "Unspecified" })).toBeChecked();
    fireEvent.click(within(salt).getByRole("button", { name: /remove salt/i }));

    fireEvent.click(screen.getByRole("button", { name: /add ingredient/i }));
    const addedIngredient = screen.getByRole("group", { name: "New ingredient 4" });
    await chooseCatalogIngredient(
      addedIngredient,
      /^ingredient$/i,
      "Orange zest",
      /^orange zest.*choose$/i,
    );
    fireEvent.click(within(addedIngredient).getByRole("radio", { name: "Exact" }));
    fireEvent.change(within(addedIngredient).getByLabelText(/^amount$/i), {
      target: { value: " 1.25 " },
    });
    fireEvent.change(within(addedIngredient).getByLabelText(/^unit$/i), {
      target: { value: TABLESPOON_ID },
    });
    fireEvent.change(within(addedIngredient).getByLabelText(/preparation notes/i), {
      target: { value: " finely grated " },
    });

    fireEvent.change(instructionInput(1), {
      target: { value: "  Whisk the dry ingredients thoroughly.  " },
    });
    expect(within(instructionRow(1)).getByText("Changed")).toBeInTheDocument();
    expandInstructionRow(2);
    fireEvent.click(screen.getByRole("button", { name: /remove step 2/i }));
    fireEvent.click(screen.getByRole("button", { name: /add instruction/i }));
    fireEvent.change(instructionInput(4), {
      target: { value: "  Cool completely before serving.  " },
    });
    const addedStep = instructionRow(4);
    fireEvent.click(
      within(addedStep).getByRole("button", { name: "Add cooking action" }),
    );
    fireEvent.change(within(addedStep).getByLabelText("Cooking action"), {
      target: { value: BAKE_ACTION_ID },
    });

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      {
        title: "Orange Pecan Carrot Cake",
        description: null,
        servings: "8.00",
        ingredient_edits: [
          {
            op: "set_measure",
            recipe_ingredient_id: "sugar-row",
            measure: {
              kind: "exact",
              value: "140.0000",
              unit_id: CUP_ID,
            },
          },
          {
            op: "replace",
            recipe_ingredient_id: "walnut-row",
            ingredient_id: PECAN_ID,
            display_name: "Pecan",
          },
          { op: "remove", recipe_ingredient_id: "salt-row" },
          {
            op: "add",
            edit_ref: "added-ingredient-1",
            ingredient_id: ORANGE_ZEST_ID,
            display_name: "Orange zest",
            measure: {
              kind: "exact",
              value: "1.25",
              unit_id: TABLESPOON_ID,
            },
            preparation_notes: "finely grated",
          },
        ],
        instruction_edits: [
          {
            op: "update",
            recipe_instruction_id: "mix-step",
            text: "Whisk the dry ingredients thoroughly.",
          },
          { op: "remove", recipe_instruction_id: "fold-step" },
          {
            op: "add",
            text: "Cool completely before serving.",
            actions: [
              {
                action_type_id: BAKE_ACTION_ID,
                ingredient_refs: [],
              },
            ],
          },
        ],
      },
      SECOND_KEY,
    );
  });

  it("applies a confirmed request resolution only to its ingredient row without losing draft work", async () => {
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor();

    const title = screen.getByLabelText(/^title$/i);
    fireEvent.change(title, { target: { value: "Request-resolved carrot cake" } });

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    expandIngredientRow(sugar, "White sugar");
    const sugarAmount = within(sugar).getByLabelText(/^amount$/i);
    fireEvent.change(sugarAmount, { target: { value: "150.0000" } });

    const firstInstruction = instructionInput(1);
    fireEvent.change(firstInstruction, {
      target: { value: "Whisk the dry ingredients very thoroughly." },
    });

    const walnuts = screen.getByRole("group", { name: /ingredient 2/i });
    expandIngredientRow(walnuts, "Walnuts");
    fireEvent.click(
      within(walnuts).getByRole("button", {
        name: "Choose from my ingredient requests for Ingredient 2: Walnuts",
      }),
    );
    fireEvent.click(
      await within(walnuts).findByRole("button", {
        name: "Use Pecan for Ingredient 2: Walnuts",
      }),
    );

    await waitFor(() =>
      expect(within(walnuts).getByText("Pecan · 100 g")).toBeVisible(),
    );
    expect(mocks.fetchMyIngredientRequest).toHaveBeenCalledWith(
      REQUEST_ID,
      expect.any(AbortSignal),
    );
    expect(title).toHaveValue("Request-resolved carrot cake");
    expect(sugarAmount).toHaveValue("150.0000");
    expect(firstInstruction).toHaveValue("Whisk the dry ingredients very thoroughly.");
    expect(within(sugar).getByText("White sugar · 150 g")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      {
        title: "Request-resolved carrot cake",
        description: "A softly spiced snack cake.",
        servings: "8.00",
        ingredient_edits: [
          {
            op: "set_measure",
            recipe_ingredient_id: "sugar-row",
            measure: {
              kind: "exact",
              value: "150.0000",
              unit_id: GRAM_ID,
            },
          },
          {
            op: "replace",
            recipe_ingredient_id: "walnut-row",
            ingredient_id: PECAN_ID,
            display_name: "Pecan",
          },
        ],
        instruction_edits: [
          {
            op: "update",
            recipe_instruction_id: "mix-step",
            text: "Whisk the dry ingredients very thoroughly.",
          },
        ],
      },
      SECOND_KEY,
    );
  });

  it("reports local validation errors without posting or clearing entered values", async () => {
    renderEditor();

    const title = screen.getByLabelText(/^title$/i);
    const servings = screen.getByLabelText(/^servings$/i);
    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    expandIngredientRow(sugar, "White sugar");
    const sugarAmount = within(sugar).getByLabelText(/^amount$/i);
    const firstStep = instructionInput(1);

    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.change(servings, { target: { value: "0.00" } });
    fireEvent.change(sugarAmount, { target: { value: "1.00001" } });
    fireEvent.change(firstStep, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Version title is required.")).toBeInTheDocument();
    expect(within(alert).getByText("Servings must be greater than zero.")).toBeInTheDocument();
    expect(
      within(alert).getByText("Amount can have at most 4 decimal places."),
    ).toBeInTheDocument();
    expect(within(alert).getByText("Instruction is required.")).toBeInTheDocument();
    expect(createRecipeVariant).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();

    expect(title).toHaveValue("   ");
    expect(servings).toHaveValue("0.00");
    expect(sugarAmount).toHaveValue("1.00001");
    expect(firstStep).toHaveValue("   ");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(servings).toHaveAttribute("aria-invalid", "true");
    expect(sugarAmount).toHaveAttribute("aria-invalid", "true");
    expect(firstStep).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("preserves the draft and stays on the editor after a backend 422", async () => {
    vi.mocked(createRecipeVariant).mockRejectedValue(
      new VariantApiError(
        "That catalog ingredient selection is no longer available.",
        422,
        "invalid_recipe_edits",
      ),
    );
    renderEditor();

    const title = screen.getByLabelText(/^title$/i);
    const walnuts = screen.getByRole("group", { name: /ingredient 2/i });
    expandIngredientRow(walnuts, "Walnuts");
    fireEvent.change(title, { target: { value: "Tropical carrot cake" } });
    await chooseCatalogIngredient(
      walnuts,
      /swap ingredient/i,
      "Pecan",
      /pecan.*also known as/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "That catalog ingredient selection is no longer available.",
      ),
    ).toBeInTheDocument();
    expect(title).toHaveValue("Tropical carrot cake");
    const selectedIngredient = within(walnuts)
      .getByText("Selected catalog ingredient")
      .closest(".ingredient-picker__selection");
    expect(selectedIngredient).not.toBeNull();
    expect(within(selectedIngredient as HTMLElement).getByText("Pecan")).toBeInTheDocument();
    expect(screen.getByRole("form")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: /^create my version$/i })).toBeEnabled();
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(mocks.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("pauses an exact match for focused acknowledgement, records continue once, then creates", async () => {
    vi.mocked(createRecipeDuplicatePreflight).mockResolvedValue(
      duplicatePreflight("exact_duplicate"),
    );
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

    const heading = await screen.findByRole("heading", {
      name: "Review an existing structural match",
    });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(createRecipeVariant).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /Public carrot cake candidate/i })).toHaveAttribute(
      "href",
      `/recipes/${CANDIDATE_ID}`,
    );

    fireEvent.click(
      screen.getByRole("checkbox", { name: /reviewed these advisory results/i }),
    );
    const continueButton = screen.getByRole("button", {
      name: "Create my version anyway",
    });
    fireEvent.click(continueButton);
    fireEvent.click(continueButton);

    await waitFor(() => expect(recordRecipeDuplicateDecision).toHaveBeenCalledOnce());
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(createRecipeDuplicatePreflight).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.any(Object),
      FIRST_KEY,
    );
    expect(recordRecipeDuplicateDecision).toHaveBeenCalledWith(
      PREFLIGHT_ID,
      {
        policy_version: "recipe-duplicate-preflight-policy-v1",
        result_digest: "a".repeat(64),
        decision: "continue",
      },
      SECOND_KEY,
    );
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.any(Object),
      THIRD_KEY,
    );
  });

  it("records revise, preserves the draft, and returns focus to editing", async () => {
    vi.mocked(createRecipeDuplicatePreflight).mockResolvedValue(
      duplicatePreflight("probable_duplicate"),
    );
    renderEditor();
    const title = screen.getByLabelText(/^title$/i);
    fireEvent.change(title, { target: { value: "Keep this probable-match draft" } });

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await screen.findByRole("heading", { name: "Review similar recipe structures" });
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    await waitFor(() => expect(recordRecipeDuplicateDecision).toHaveBeenCalledOnce());
    expect(recordRecipeDuplicateDecision).toHaveBeenCalledWith(
      PREFLIGHT_ID,
      expect.objectContaining({ decision: "revise" }),
      SECOND_KEY,
    );
    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveValue("Keep this probable-match draft");
    expect(screen.queryByRole("region", { name: /similar recipe structures/i })).toBeNull();
    expect(createRecipeVariant).not.toHaveBeenCalled();
  });

  it("uses fresh preflight evidence when an unchanged revised draft is resubmitted", async () => {
    vi.mocked(createRecipeDuplicatePreflight).mockResolvedValue(
      duplicatePreflight("probable_duplicate"),
    );
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor();

    const submit = screen.getByRole("button", { name: /^create my version$/i });
    fireEvent.click(submit);
    await screen.findByRole("heading", { name: "Review similar recipe structures" });
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await waitFor(() => expect(recordRecipeDuplicateDecision).toHaveBeenCalledOnce());

    fireEvent.click(submit);
    await screen.findByRole("heading", { name: "Review similar recipe structures" });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /reviewed these advisory results/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create my version anyway" }));

    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(
      vi.mocked(createRecipeDuplicatePreflight).mock.calls.map((call) => call[2]),
    ).toEqual([FIRST_KEY, THIRD_KEY]);
    expect(
      vi.mocked(recordRecipeDuplicateDecision).mock.calls.map((call) => call[2]),
    ).toEqual([SECOND_KEY, FOURTH_KEY]);
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.any(Object),
      FIFTH_KEY,
    );
  });

  it("invalidates a no-change review immediately when the draft changes", async () => {
    vi.mocked(createRecipeDuplicatePreflight).mockResolvedValue(
      duplicatePreflight("exact_duplicate", {
        same_lineage_no_change: true,
        candidates: [],
        warnings: [
          {
            code: "same_lineage_no_change",
            message: "The structured recipe is unchanged from its direct parent.",
          },
        ],
      }),
    );
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await screen.findByRole("region", {
      name: "This version keeps the same recipe structure",
    });
    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "A newly revised title" },
    });

    expect(
      screen.queryByRole("region", {
        name: "This version keeps the same recipe structure",
      }),
    ).toBeNull();
    expect(screen.getByLabelText(/^title$/i)).toHaveValue("A newly revised title");
    expect(screen.getByRole("status")).toHaveTextContent(/draft changed/i);
    expect(recordRecipeDuplicateDecision).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "503 availability response",
      error: new RecipeDuplicateApiError(
        "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
        503,
        "duplicate_preflight_unavailable",
      ),
    },
    { name: "network failure", error: new TypeError("fetch failed") },
    {
      name: "malformed successful response",
      error: new RecipeDuplicateApiError(
        "Recipe Lab received an invalid similarity review response.",
        502,
        "invalid_recipe_duplicate_response",
      ),
    },
  ])(
    "requires an explicit create choice after a $name",
    async ({ error }) => {
      vi.mocked(createRecipeDuplicatePreflight).mockRejectedValue(error);
      vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
      renderEditor();
      const title = screen.getByLabelText(/^title$/i);
      fireEvent.change(title, { target: { value: "Preserved unavailable draft" } });

      fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

      const fallback = await screen.findByRole("region", {
        name: "Similarity review could not be completed",
      });
      await waitFor(() =>
        expect(
          within(fallback).getByRole("heading", {
            name: "Similarity review could not be completed",
          }),
        ).toHaveFocus(),
      );
      expect(fallback).toHaveTextContent("does not mean your version is distinct");
      expect(title).toHaveValue("Preserved unavailable draft");
      expect(createRecipeVariant).not.toHaveBeenCalled();
      expect(recordRecipeDuplicateDecision).not.toHaveBeenCalled();

      fireEvent.click(
        within(fallback).getByRole("button", {
          name: "Create without similarity review",
        }),
      );
      await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
      expect(createRecipeVariant).toHaveBeenCalledWith(
        SOURCE_ID,
        expect.any(Object),
        SECOND_KEY,
      );
      expect(recordRecipeDuplicateDecision).not.toHaveBeenCalled();
    },
  );

  it("retries an unavailable review with the same preflight key before auto-creating distinct", async () => {
    vi.mocked(createRecipeDuplicatePreflight)
      .mockRejectedValueOnce(
        new RecipeDuplicateApiError(
          "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
          503,
          "duplicate_preflight_unavailable",
        ),
      )
      .mockResolvedValueOnce(duplicatePreflight("distinct"));
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    const fallback = await screen.findByRole("region", {
      name: "Similarity review could not be completed",
    });
    expect(createRecipeVariant).not.toHaveBeenCalled();
    fireEvent.click(
      within(fallback).getByRole("button", { name: "Retry similarity review" }),
    );

    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(
      vi.mocked(createRecipeDuplicatePreflight).mock.calls.map((call) => call[2]),
    ).toEqual([FIRST_KEY, FIRST_KEY]);
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.any(Object),
      SECOND_KEY,
    );
  });

  it.each([
    {
      name: "expired session",
      error: new RecipeDuplicateApiError(
        "Your session expired. Sign in again to continue.",
        401,
        "authentication_required",
      ),
    },
    {
      name: "unavailable source",
      error: new RecipeDuplicateApiError(
        "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
        404,
        "recipe_not_found",
      ),
    },
    {
      name: "stale preflight conflict",
      error: new RecipeDuplicateApiError(
        "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
        409,
        "duplicate_preflight_stale",
      ),
    },
    {
      name: "invalid recipe edits",
      error: new RecipeDuplicateApiError(
        "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
        422,
        "invalid_recipe_edits",
      ),
    },
  ])("preserves every draft field after a $name", async ({ error }) => {
    vi.mocked(createRecipeDuplicatePreflight).mockRejectedValue(error);
    renderEditor();
    const title = screen.getByLabelText(/^title$/i);
    fireEvent.change(title, { target: { value: "Preserve this title" } });

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

    const alert = await screen.findByRole("alert");
    expect(title).toHaveValue("Preserve this title");
    expect(createRecipeVariant).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: /recipe structure/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Create without similarity review" }),
    ).toBeNull();
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("clears candidate details after a stale acknowledgement decision", async () => {
    vi.mocked(createRecipeDuplicatePreflight).mockResolvedValue(
      duplicatePreflight("probable_duplicate"),
    );
    vi.mocked(recordRecipeDuplicateDecision).mockRejectedValueOnce(
      new RecipeDuplicateApiError(
        "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
        409,
        "duplicate_preflight_stale",
      ),
    );
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await screen.findByRole("link", { name: /Public carrot cake candidate/i });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /reviewed these advisory results/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create my version anyway" }));

    await screen.findByRole("alert");
    expect(screen.queryByRole("link", { name: /Public carrot cake candidate/i })).toBeNull();
    expect(screen.getByLabelText(/^title$/i)).toHaveValue(
      "Carrot Walnut Snack Cake variation",
    );
    expect(createRecipeVariant).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await screen.findByRole("heading", { name: "Review similar recipe structures" });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /reviewed these advisory results/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create my version anyway" }));
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(
      vi.mocked(createRecipeDuplicatePreflight).mock.calls.map((call) => call[2]),
    ).toEqual([FIRST_KEY, THIRD_KEY]);
    expect(
      vi.mocked(recordRecipeDuplicateDecision).mock.calls.map((call) => call[2]),
    ).toEqual([SECOND_KEY, FOURTH_KEY]);
  });

  it.each([
    {
      name: "unavailable response",
      error: new RecipeDuplicateApiError(
        "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
        503,
      ),
    },
    {
      name: "malformed successful response",
      error: new RecipeDuplicateApiError(
        "Recipe Lab received an invalid similarity decision response.",
        502,
        "invalid_recipe_duplicate_decision_response",
      ),
    },
  ])("retries a commit-ambiguous $name with the same decision key, then creates", async ({
    error,
  }) => {
    vi.mocked(createRecipeDuplicatePreflight).mockResolvedValue(
      duplicatePreflight("probable_duplicate"),
    );
    vi.mocked(recordRecipeDuplicateDecision)
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({
        preflight_id: PREFLIGHT_ID,
        decision: "continue",
        recorded_at: "2026-08-25T12:00:00Z",
      });
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await screen.findByRole("heading", { name: "Review similar recipe structures" });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /reviewed these advisory results/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create my version anyway" }));
    const failureHeading = await screen.findByRole("heading", {
      name: "Your review choice could not be confirmed",
    });
    await waitFor(() => expect(failureHeading).toHaveFocus());
    expect(createRecipeVariant).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Retry recording my choice" }));

    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(createRecipeDuplicatePreflight).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(recordRecipeDuplicateDecision).mock.calls.map((call) => call[2]),
    ).toEqual([SECOND_KEY, SECOND_KEY]);
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.any(Object),
      THIRD_KEY,
    );
  });

  it("requires an explicit create when a continue decision cannot be recorded", async () => {
    vi.mocked(createRecipeDuplicatePreflight).mockResolvedValue(
      duplicatePreflight("probable_duplicate"),
    );
    vi.mocked(recordRecipeDuplicateDecision).mockRejectedValue(
      new RecipeDuplicateApiError(
        "Recipe Lab could not check this version right now. Your draft is still here; please try again.",
        503,
      ),
    );
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await screen.findByRole("heading", { name: "Review similar recipe structures" });
    fireEvent.click(
      screen.getByRole("checkbox", { name: /reviewed these advisory results/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Create my version anyway" }));
    await screen.findByRole("heading", {
      name: "Your review choice could not be confirmed",
    });
    expect(createRecipeVariant).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Create without confirming the review decision",
      }),
    );
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(recordRecipeDuplicateDecision).toHaveBeenCalledOnce();
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.any(Object),
      THIRD_KEY,
    );
  });

  it("returns to an intact draft when a revise decision cannot be recorded", async () => {
    vi.mocked(createRecipeDuplicatePreflight).mockResolvedValue(
      duplicatePreflight("probable_duplicate"),
    );
    vi.mocked(recordRecipeDuplicateDecision).mockRejectedValue(
      new TypeError("fetch failed"),
    );
    renderEditor();
    const title = screen.getByLabelText(/^title$/i);
    fireEvent.change(title, { target: { value: "Keep this decision-failure draft" } });

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));
    await screen.findByRole("heading", { name: "Review similar recipe structures" });
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    await screen.findByRole("heading", {
      name: "Your review choice could not be confirmed",
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Return to editing without confirming the review decision",
      }),
    );

    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveValue("Keep this decision-failure draft");
    expect(screen.queryByRole("region", { name: /similar recipe structures/i })).toBeNull();
    expect(createRecipeVariant).not.toHaveBeenCalled();
  });

  it("reuses a failed fork key until the draft changes", async () => {
    vi.mocked(createRecipeVariant)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(createdRecipe());
    renderEditor();

    const createButton = screen.getByRole("button", { name: /^create my version$/i });
    fireEvent.click(createButton);
    await screen.findByRole("alert");
    fireEvent.click(createButton);
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledTimes(2));
    await screen.findByRole("alert");

    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "A revised carrot cake variant" },
    });
    fireEvent.click(createButton);

    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(createRecipeVariant).mock.calls;
    expect(calls[0]?.[2]).toBe(SECOND_KEY);
    expect(calls[1]?.[2]).toBe(SECOND_KEY);
    expect(calls[2]?.[2]).toBe(FOURTH_KEY);
    const preflightCalls = vi.mocked(createRecipeDuplicatePreflight).mock.calls;
    expect(preflightCalls[0]?.[2]).toBe(FIRST_KEY);
    expect(preflightCalls[1]?.[2]).toBe(FIRST_KEY);
    expect(preflightCalls[2]?.[2]).toBe(THIRD_KEY);
    expect(mocks.createIdempotencyKey).toHaveBeenCalledTimes(4);
  });

  it("guards against same-tick duplicate submissions while creation is pending", async () => {
    const request = deferred<RecipeDetail>();
    vi.mocked(createRecipeVariant).mockReturnValue(request.promise);
    renderEditor();

    const form = screen.getByRole("form");
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(createRecipeDuplicatePreflight).toHaveBeenCalledOnce();
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(form).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /creating your version/i })).toBeDisabled();
    expect(screen.getByText(/creating your version/i, { selector: "p" })).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByText(/^cancel$/i)).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      request.resolve(createdRecipe());
      await request.promise;
    });
    expect(mocks.replace).toHaveBeenCalledWith(`/recipes/${CHILD_ID}`);
  });

  it("replaces the editor route with the newly created recipe version", async () => {
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    renderEditor();

    fireEvent.click(screen.getByRole("button", { name: /^create my version$/i }));

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledOnce();
      expect(mocks.replace).toHaveBeenCalledWith(`/recipes/${CHILD_ID}`);
    });
    expect(screen.getByRole("form")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your version is ready. Opening the recipe…",
    );
  });
});
