import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../lib/auth-api";
import type { RecipeDetail } from "../../lib/recipe-api";
import type { RecipeInstructionAction } from "../../lib/structured-action";
import { AuthSessionProvider } from "./auth-session-provider";
import { RecipeDetailView } from "./recipe-detail-view";

const mocks = vi.hoisted(() => ({
  fetchCookFollowState: vi.fn(),
  fetchRecipeViewerState: vi.fn(),
  setCookFollowing: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("../../lib/interaction-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/interaction-api")>();
  return { ...actual, fetchRecipeViewerState: mocks.fetchRecipeViewerState };
});

vi.mock("../../lib/member-follow-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/member-follow-api")>();
  return {
    ...actual,
    fetchCookFollowState: mocks.fetchCookFollowState,
    setCookFollowing: mocks.setCookFollowing,
  };
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
    categories: [
      { id: "category-one", name: "Baking", slug: "baking" },
      { id: "category-two", name: "Dessert", slug: "dessert" },
    ],
    created_at: "2026-08-20T00:00:00Z",
    published_at: "2026-08-21T00:00:00Z",
    author: {
      id: "cook-two",
      handle: "second-cook",
      display_name: "Second Cook",
    },
    average_rating: 4.5,
    rating_count: 2,
    save_count: 876,
    total_time_minutes: 85,
    active_time_minutes: 25,
    difficulty: "medium",
    notes: null,
    viewer_state: null,
    parent: {
      id: "carrot-v1",
      version_number: 1,
      title: "Carrot Walnut Snack Cake",
      author: {
        id: "cook-one",
        handle: "first-cook",
        display_name: "First Cook",
      },
    },
    children: [
      {
        id: "carrot-v3",
        version_number: 3,
        title: "Orange Raisin Carrot Cake",
        author: {
          id: "cook-three",
          handle: "third-cook",
          display_name: "Third Cook",
        },
      },
    ],
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
        title: null,
        text: "Heat the oven and prepare the pan.",
        display_order: 0,
        actions: [],
      },
      {
        id: "step-two",
        title: null,
        text: "Fold the dry ingredients into the wet mixture.",
        display_order: 1,
        actions: [],
      },
    ],
    ...overrides,
  };
}

function renderDetail(
  recipe: RecipeDetail,
  session: AuthSession = { status: "anonymous" },
) {
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
  window.history.replaceState(null, "", "/");
  mocks.fetchRecipeViewerState.mockResolvedValue({
    recipe_version_id: "carrot-v2",
    saved: false,
    rating: null,
  });
  mocks.fetchCookFollowState.mockResolvedValue({
    cook_id: "cook-two",
    follower_count: 3,
    following: false,
  });
});

describe("RecipeDetailView", () => {
  it("keeps anonymous browsing, detail, recipe history, and comparison public", () => {
    const { container } = renderDetail(detail());

    expect(
      screen.getByRole("heading", {
        name: /lower-sugar pecan carrot cake/i,
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Version", {
        selector: ".recipe-detail__version-badge",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Recipe", { selector: ".eyebrow" })).toBeNull();
    expect(
      container.querySelector(".recipe-detail__intro"),
    ).not.toHaveTextContent(/version \d+/i);
    expect(container.querySelector(".recipe-detail__artwork")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      screen.getByLabelText(/4\.5 out of 5 from 2 ratings/i),
    ).toBeInTheDocument();
    expect(container.querySelector(".rating-summary__label")).toBeNull();
    expect(container.querySelector(".rating-summary__stars")).toHaveTextContent(
      "★★★★★",
    );
    expect(
      within(
        container.querySelector(".recipe-detail__member-actions")!,
      ).getByText("876 saves"),
    ).toBeVisible();
    expect(screen.getByText("1 hr 25 min")).toBeVisible();
    expect(screen.getByText("25 min")).toBeVisible();
    expect(screen.getByText("Medium")).toBeVisible();
    expect(screen.getByRole("button", { name: "Save recipe" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Rate recipe" })).toBeVisible();
    expect(
      screen.queryByRole("region", { name: /save and rate this recipe/i }),
    ).toBeNull();
    expect(screen.queryByTestId("view-tracker")).toBeNull();
    expect(mocks.fetchRecipeViewerState).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("link", { name: /see what changed/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Recipe family context" }),
    ).toBeNull();
    expect(screen.getByText("140 g")).toBeInTheDocument();
    expect(screen.getByLabelText("Mark White sugar as gathered")).toBeVisible();
    const ingredients = screen
      .getByRole("heading", { name: "Ingredients", level: 2 })
      .closest("section");
    expect(ingredients).not.toBeNull();
    expect(within(ingredients!).queryByText("8 servings")).toBeNull();
    const tabs = screen.getByRole("tablist", { name: "Recipe sections" });
    const recipeTab = within(tabs).getByRole("tab", { name: "Recipe" });
    const notesTab = within(tabs).getByRole("tab", { name: "Notes" });
    const familyTab = within(tabs).getByRole("tab", { name: "Family" });
    expect(recipeTab).toHaveAttribute("aria-selected", "true");
    expect(notesTab).toHaveAttribute("aria-selected", "false");
    expect(familyTab).toHaveAttribute("aria-selected", "false");
    const followLink = screen.getByRole("link", { name: "Follow" });
    expect(followLink).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Frecipes%2Fcarrot-v2",
    );
    const followControl = followLink.closest(".cook-follow-control");
    const authorRow = followLink.closest(".recipe-detail__author-row");
    expect(authorRow).not.toBeNull();
    expect(followControl?.parentElement).toBe(authorRow);
    expect(authorRow?.lastElementChild).toBe(followControl);
    const categories = screen.getByRole("list", {
      name: "Categories for Lower-Sugar Pecan Carrot Cake",
    });
    expect(within(categories).getByText("Baking")).toBeVisible();
    expect(within(categories).getByText("Dessert")).toBeVisible();
    expect(within(categories).queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByText(/catalog name:/i)).toBeNull();
    expect(
      screen.getAllByRole("link", { name: "Second Cook" })[0],
    ).toHaveAttribute("href", "/cooks/second-cook");
    expect(
      container.querySelector(".recipe-detail__parent-context"),
    ).toHaveTextContent("Based on Carrot Walnut Snack Cake by First Cook");
    expect(
      screen.getAllByRole("link", { name: "First Cook" })[0],
    ).toHaveAttribute("href", "/cooks/first-cook");

    const instructions = screen
      .getByRole("heading", { name: /instructions/i })
      .closest("section");
    expect(instructions).not.toBeNull();
    expect(within(instructions!).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(instructions!).queryByText(/cooking actions added/i),
    ).toBeNull();
    expect(instructions).not.toHaveTextContent(
      /Inputs:|Duration:|Temperature:/,
    );

    fireEvent.click(notesTab);
    expect(notesTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("heading", { name: "Notes from Second Cook" }),
    ).toBeVisible();
    expect(
      screen.getByText("No notes were added for this recipe."),
    ).toBeVisible();
    expect(
      screen.getByRole("tabpanel", { name: "Notes" }).querySelector(".eyebrow"),
    ).toBeNull();

    fireEvent.keyDown(notesTab, { key: "ArrowRight" });
    expect(familyTab).toHaveFocus();
    expect(familyTab).toHaveAttribute("aria-selected", "true");
    expect(
      screen
        .getByRole("tabpanel", { name: "Family" })
        .querySelector(".eyebrow"),
    ).toBeNull();
    const familyPanel = screen.getByRole("tabpanel", { name: "Family" });
    expect(
      within(familyPanel).getByLabelText(
        "Selected family recipe: Lower-Sugar Pecan Carrot Cake",
      ),
    ).toHaveTextContent("Lower-Sugar Pecan Carrot Cake");
    expect(
      within(familyPanel).getByRole("button", {
        name: "Show Carrot Walnut Snack Cake in the family tree",
      }),
    ).toBeVisible();
    expect(
      within(familyPanel).getByRole("link", {
        name: "Carrot Walnut Snack Cake",
      }),
    ).toHaveAttribute("href", "/recipes/carrot-v1");
    fireEvent.click(
      within(familyPanel).getByRole("button", {
        name: "Show Orange Raisin Carrot Cake in the family tree",
      }),
    );
    expect(
      within(familyPanel).getByLabelText(
        "Selected family recipe: Orange Raisin Carrot Cake",
      ),
    ).toBeVisible();
    expect(
      within(familyPanel).getByRole("link", {
        name: "Orange Raisin Carrot Cake",
      }),
    ).toHaveAttribute("href", "/recipes/carrot-v3");
    expect(
      within(familyPanel).getByRole("link", {
        name: "Compare with Lower-Sugar Pecan Carrot Cake →",
      }),
    ).toHaveAttribute(
      "href",
      "/recipes/carrot-v3/compare?base_version_id=carrot-v2",
    );
  });

  it("renders deleted attribution and an unavailable parent without leaking links or comparison", () => {
    renderDetail(
      detail({
        author: {
          id: "deleted-id",
          handle: null,
          display_name: "Deleted cook",
        },
        parent: null,
        children: [],
      }),
    );

    expect(
      screen.getAllByText("Deleted cook", { exact: true }),
    ).not.toHaveLength(0);
    expect(screen.queryByRole("link", { name: "Deleted cook" })).toBeNull();
    expect(
      screen.getAllByText("Source unavailable", { exact: true }),
    ).toHaveLength(2);
    expect(
      screen.queryByRole("link", { name: /see what changed/i }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Family" }));
    const familyPanel = screen.getByRole("tabpanel", { name: "Family" });
    expect(
      within(familyPanel).queryByText("Carrot Walnut Snack Cake"),
    ).toBeNull();
    expect(within(familyPanel).queryByText("First Cook")).toBeNull();
    expect(within(familyPanel).getByText("Source unavailable")).toBeVisible();
    expect(
      within(familyPanel).getByLabelText(
        "Selected family recipe: Lower-Sugar Pecan Carrot Cake",
      ),
    ).toBeInTheDocument();
  });

  it("renders the legacy Demo Cook identity without a profile link", () => {
    renderDetail(
      detail({
        author: {
          id: "1fc5b3b8-cf73-54ce-b5d6-ed3c30df9fd9",
          handle: null,
          display_name: "Demo Cook",
        },
      }),
    );

    expect(screen.getAllByText("Demo Cook", { exact: true })).not.toHaveLength(
      0,
    );
    expect(screen.queryByRole("link", { name: "Demo Cook" })).toBeNull();
  });

  it("hydrates private controls only after the authenticated member state loads", async () => {
    const { container } = renderDetail(detail(), member);

    expect(
      screen.getByRole("region", { name: /member recipe actions/i }),
    ).toHaveTextContent(/loading your saved and rating state/i);
    expect(
      await screen.findByRole("region", { name: /save and rate this recipe/i }),
    ).toBeVisible();
    expect(mocks.fetchRecipeViewerState).toHaveBeenCalledWith(
      "carrot-v2",
      expect.any(AbortSignal),
    );
    expect(
      screen.getByRole("button", { name: /save recipe/i }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(
      screen.getByRole("button", { name: /make your own version/i }),
    ).toBeVisible();
    expect(screen.getByTestId("view-tracker")).toHaveTextContent("carrot-v2");
    const socialRow = container.querySelector<HTMLElement>(
      ".recipe-detail__social-row",
    );
    expect(socialRow).not.toBeNull();
    expect(
      within(socialRow!).getByLabelText(/4\.5 out of 5 from 2 ratings/i),
    ).toBeVisible();
    expect(within(socialRow!).getByText("876 saves")).toBeVisible();
    const publicationRow = container.querySelector<HTMLElement>(
      ".recipe-detail__label-row",
    );
    expect(publicationRow).not.toBeNull();
    expect(
      within(publicationRow!).getByRole("button", { name: "Report recipe" }),
    ).toBeVisible();
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
    const unavailableIngredientId = "99999999-9999-4999-8999-999999999999";
    const fold = structuredAction("fold", "fold", 1, [unavailableIngredientId]);
    fold.action_type.active = false;
    const line = structuredAction("line", "line", 2, []);
    recipe.instructions[0].title = "Prepare the pan";
    recipe.instructions[0].actions = [line, fold, mix];

    renderDetail(recipe);

    expect(
      screen.getByText("Heat the oven and prepare the pan."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Prepare the pan" }),
    ).toBeVisible();
    expect(screen.getByRole("tab", { name: "Steps" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Cooking breakdown" }));
    const actions = screen.getByRole("list", {
      name: "Cooking breakdown for step 1",
    });
    const rendered = within(actions).getAllByRole("listitem");
    expect(rendered).toHaveLength(3);
    expect(within(rendered[0]).getByText("Mix")).toBeInTheDocument();
    expect(within(rendered[0]).getByText("White sugar")).toBeInTheDocument();
    expect(within(rendered[0]).getByText("5 minutes")).toBeInTheDocument();
    expect(within(rendered[1]).getByText("Fold")).toBeInTheDocument();
    expect(
      within(rendered[1]).getByText("Previously used action"),
    ).toBeInTheDocument();
    expect(
      within(rendered[1]).getByText("Ingredient no longer available"),
    ).toBeInTheDocument();
    expect(within(rendered[2]).getByText("Line pan")).toBeInTheDocument();
    expect(
      within(rendered[2]).getByText("No ingredient linked"),
    ).toBeInTheDocument();
    expect(actions).not.toHaveTextContent(unavailableIngredientId);
    expect(actions).not.toHaveTextContent(
      /Inputs:|Duration:|Temperature:|Historical action/,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Steps" }));
    expect(
      screen.getByText("Heat the oven and prepare the pan."),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(
      screen.getByText("No notes were added for this recipe."),
    ).toBeVisible();
  });

  it("renders authored recipe notes in the Notes tab", () => {
    renderDetail(
      detail({
        notes: "Rest the cake completely before adding the glaze.",
      }),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Notes" }));
    expect(
      screen.getByText("Rest the cake completely before adding the glaze."),
    ).toBeVisible();
    expect(
      screen.queryByText("No notes were added for this recipe."),
    ).toBeNull();
  });

  it("renders honest empty aggregate and recipe-history states without exposing private controls", () => {
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
    expect(
      screen.getByText("Original", {
        selector: ".recipe-detail__version-badge",
      }),
    ).toBeVisible();
    expect(screen.queryByText(/version \d+/i)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Family" }));
    expect(
      screen.getByText(/no versions have been created from this recipe yet/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /see what changed/i }),
    ).toBeNull();
    expect(screen.queryByRole("link", { name: /based on/i })).toBeNull();
  });
});
