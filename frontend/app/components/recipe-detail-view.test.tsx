import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../lib/auth-api";
import type { RecipeDetail } from "../../lib/recipe-api";
import type { RecipeInstructionAction } from "../../lib/structured-action";
import { AuthSessionProvider } from "./auth-session-provider";
import { RecipeDetailView } from "./recipe-detail-view";

const mocks = vi.hoisted(() => ({
  fetchRecipeViewerState: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("../../lib/interaction-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/interaction-api")>();
  return { ...actual, fetchRecipeViewerState: mocks.fetchRecipeViewerState };
});

vi.mock("./recipe-view-tracker", () => ({
  RecipeViewTracker: ({ recipeVersionId }: { recipeVersionId: string }) => (
    <span data-testid="view-tracker">{recipeVersionId}</span>
  ),
}));

const member: AuthSession = {
  status: "authenticated",
  user: { id: "member-one", display_name: "First Cook", handle: "first-cook" },
};

function detail(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    id: "carrot-v2",
    lineage_id: "carrot-lineage",
    parent_version_id: "carrot-v1",
    version_number: 2,
    title: "Lower-Sugar Pecan Carrot Cake",
    description: "The original snack cake with less sugar and pecans.",
    servings: "8.00",
    created_at: "2026-08-20T00:00:00Z",
    average_rating: 4.5,
    rating_count: 2,
    viewer_state: null,
    parent: { id: "carrot-v1", version_number: 1, title: "Carrot Walnut Snack Cake" },
    children: [{ id: "carrot-v3", version_number: 3, title: "Orange Raisin Carrot Cake" }],
    ingredients: [
      {
        id: "sugar-line",
        ingredient_id: "sugar",
        canonical_name: "Granulated sugar",
        display_name: "White sugar",
        measure: {
          kind: "exact",
          value: "140.0000",
          unit: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            key: "gram",
            dimension: "mass",
            canonical_label: "gram",
            plural_label: "grams",
            symbol: "g",
            display_style: "symbol",
            active: true,
          },
          display_unit: "g",
          display: "140 g",
        },
        preparation_notes: "divided",
        display_order: 0,
      },
      {
        id: "salt-line",
        ingredient_id: "salt",
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
        display_order: 1,
      },
    ],
    instructions: [
      {
        id: "step-one",
        text: "Heat the oven and prepare the pan.",
        display_order: 0,
        actions: [],
      },
      {
        id: "step-two",
        text: "Fold the dry ingredients into the wet mixture.",
        display_order: 1,
        actions: [],
      },
    ],
    ...overrides,
  };
}

function renderDetail(recipe: RecipeDetail, session: AuthSession = { status: "anonymous" }) {
  return render(
    <AuthSessionProvider initialSession={session}>
      <RecipeDetailView recipe={recipe} />
    </AuthSessionProvider>,
  );
}

function structuredAction(
  id: string,
  verb: string,
  displayOrder: number,
  ingredientOccurrenceIds: string[] = [],
): RecipeInstructionAction {
  return {
    id,
    action_type: {
      id: `type-${id}`,
      key: verb,
      canonical_verb: verb,
      active: true,
    },
    display_order: displayOrder,
    ingredient_occurrence_ids: ingredientOccurrenceIds,
    duration: null,
    temperature: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRecipeViewerState.mockResolvedValue({
    recipe_version_id: "carrot-v2",
    saved: false,
    rating: null,
  });
});

describe("RecipeDetailView", () => {
  it("keeps anonymous browsing, detail, lineage, and comparison public", () => {
    const { container } = renderDetail(detail());

    expect(
      screen.getByRole("heading", { name: /lower-sugar pecan carrot cake/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Variation", { selector: ".eyebrow" })).toBeInTheDocument();
    expect(container.querySelector(".recipe-detail__artwork")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByLabelText(/4\.5 out of 5 from 2 ratings/i)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /member recipe actions/i })).toHaveTextContent(
      /sign in to save or rate/i,
    );
    expect(screen.queryByRole("region", { name: /save and rate this recipe/i })).toBeNull();
    expect(screen.queryByTestId("view-tracker")).toBeNull();
    expect(mocks.fetchRecipeViewerState).not.toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /see what changed/i })).toHaveAttribute(
      "href",
      "/recipes/carrot-v2/compare",
    );
    expect(screen.getByText("140 g")).toBeInTheDocument();
    expect(screen.getByText(/catalog name: granulated sugar/i)).toBeInTheDocument();

    const instructions = screen.getByRole("heading", { name: /instructions/i }).closest("section");
    expect(instructions).not.toBeNull();
    expect(within(instructions!).getAllByRole("listitem")).toHaveLength(2);
    const lineage = screen.getByRole("list", { name: /more versions of this recipe/i });
    expect(within(lineage).getAllByRole("listitem")).toHaveLength(3);
  });

  it("hydrates private controls only after the authenticated member state loads", async () => {
    renderDetail(detail(), member);

    expect(screen.getByRole("region", { name: /member recipe actions/i })).toHaveTextContent(
      /loading your saved and rating state/i,
    );
    expect(await screen.findByRole("region", { name: /save and rate this recipe/i })).toBeVisible();
    expect(mocks.fetchRecipeViewerState).toHaveBeenCalledWith(
      "carrot-v2",
      expect.any(AbortSignal),
    );
    expect(screen.getByRole("button", { name: /save recipe/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("link", { name: /make your own version/i })).toHaveAttribute(
      "href",
      "/recipes/carrot-v2/fork",
    );
    expect(screen.getByTestId("view-tracker")).toHaveTextContent("carrot-v2");
  });

  it("keeps prose primary while rendering ordered action structure and exact ingredient occurrences", () => {
    const recipe = detail();
    const mix = structuredAction("mix", "mix", 0, ["sugar-line"]);
    mix.duration = {
      kind: "exact",
      value: "5.0000",
      unit: {
        id: "minute-unit",
        key: "minute",
        dimension: "time",
        canonical_label: "minute",
        plural_label: "minutes",
        symbol: "min",
        display_style: "word",
        active: true,
      },
      display_unit: "minutes",
      display: "5 minutes",
    };
    const fold = structuredAction("fold", "fold", 1, ["salt-line"]);
    fold.action_type.active = false;
    recipe.instructions[0].actions = [fold, mix];

    renderDetail(recipe);

    expect(screen.getByText("Heat the oven and prepare the pan.")).toBeInTheDocument();
    const actions = screen.getByRole("list", { name: "Structured actions for step 1" });
    const rendered = within(actions).getAllByRole("listitem");
    expect(rendered).toHaveLength(2);
    expect(within(rendered[0]).getByText("mix")).toBeInTheDocument();
    expect(within(rendered[0]).getByText("Inputs: Ingredient 1: White sugar")).toBeInTheDocument();
    expect(within(rendered[0]).getByText("Duration: 5 minutes")).toBeInTheDocument();
    expect(within(rendered[1]).getByText("fold")).toBeInTheDocument();
    expect(within(rendered[1]).getByText("Historical action")).toBeInTheDocument();
  });

  it("renders honest empty aggregate and lineage states without exposing private controls", () => {
    renderDetail(
      detail({
        average_rating: null,
        rating_count: 0,
        parent_version_id: null,
        parent: null,
        children: [],
        version_number: 1,
      }),
    );

    expect(screen.getByLabelText(/no ratings yet/i)).toBeInTheDocument();
    expect(screen.getByText("Original", { selector: ".eyebrow" })).toBeInTheDocument();
    expect(screen.getByText(/does not have another version yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /see what changed/i })).toBeNull();
    expect(screen.queryByRole("link", { name: /based on/i })).toBeNull();
  });
});
