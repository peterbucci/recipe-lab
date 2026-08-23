import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RecipeDetail } from "../../lib/recipe-api";
import { RecipeDetailView } from "./recipe-detail-view";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("./recipe-view-tracker", () => ({
  RecipeViewTracker: () => null,
}));

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
    viewer_state: {
      recipe_version_id: "carrot-v2",
      user: {
        id: "demo-cook",
        display_name: "Demo Cook",
        identity_mode: "shared_demo",
      },
      saved: false,
      rating: null,
    },
    parent: { id: "carrot-v1", version_number: 1, title: "Carrot Walnut Snack Cake" },
    children: [{ id: "carrot-v3", version_number: 3, title: "Orange Raisin Carrot Cake" }],
    ingredients: [
      {
        id: "sugar-line",
        ingredient_id: "sugar",
        canonical_name: "Granulated sugar",
        display_name: "White sugar",
        quantity: "140.0000",
        unit: "g",
        preparation_notes: "divided",
        display_order: 0,
      },
      {
        id: "salt-line",
        ingredient_id: "salt",
        canonical_name: "Salt",
        display_name: "Salt",
        quantity: null,
        unit: null,
        preparation_notes: null,
        display_order: 1,
      },
    ],
    instructions: [
      { id: "step-one", text: "Heat the oven and prepare the pan.", display_order: 0 },
      { id: "step-two", text: "Fold the dry ingredients into the wet mixture.", display_order: 1 },
    ],
    ...overrides,
  };
}

describe("RecipeDetailView", () => {
  it("leads with the recipe, cooking actions, and immediate family links", () => {
    const { container } = render(<RecipeDetailView recipe={detail()} />);

    expect(
      screen.getByRole("heading", { name: /lower-sugar pecan carrot cake/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Variation", { selector: ".eyebrow" })).toBeInTheDocument();
    expect(container.querySelector(".recipe-detail__artwork")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(screen.getByLabelText(/4\.5 out of 5 from 2 ratings/i)).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /save and rate this recipe/i }),
    ).toHaveTextContent(/public demo.*shared demo cook profile/i);
    expect(screen.queryByRole("heading", { name: /demo activity/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save recipe/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("link", { name: /make your own version/i })).toHaveAttribute(
      "href",
      "/recipes/carrot-v2/fork",
    );
    expect(screen.getByRole("link", { name: /see what changed/i })).toHaveAttribute(
      "href",
      "/recipes/carrot-v2/compare",
    );
    expect(screen.getByText("140 g")).toBeInTheDocument();
    expect(screen.getByText("White sugar")).toBeInTheDocument();
    expect(screen.getByText(/catalog name: granulated sugar/i)).toBeInTheDocument();
    expect(screen.getByText("divided")).toBeInTheDocument();
    expect(screen.getByText(/amount not specified/i)).toBeInTheDocument();
    expect(screen.queryByText("Mise en place", { selector: ".eyebrow" })).not.toBeInTheDocument();
    expect(screen.queryByText("Method", { selector: ".eyebrow" })).not.toBeInTheDocument();
    expect(screen.queryByText("Recipe family", { selector: ".eyebrow" })).not.toBeInTheDocument();

    const instructions = screen.getByRole("heading", { name: /instructions/i }).closest("section");
    expect(instructions).not.toBeNull();
    expect(within(instructions!).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Heat the oven and prepare the pan.",
      "Fold the dry ingredients into the wet mixture.",
    ]);

    const lineage = screen.getByRole("list", { name: /more versions of this recipe/i });
    expect(within(lineage).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(lineage).getByRole("link", { name: /based on.*carrot walnut snack cake/i }),
    ).toHaveAttribute("href", "/recipes/carrot-v1");
    expect(
      within(lineage).getByRole("link", {
        name: /another version.*orange raisin carrot cake/i,
      }),
    ).toHaveAttribute("href", "/recipes/carrot-v3");
    expect(within(lineage).getByLabelText(/current recipe version/i)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("renders honest empty rating and lineage states", () => {
    render(
      <RecipeDetailView
        recipe={detail({
          average_rating: null,
          rating_count: 0,
          parent_version_id: null,
          parent: null,
          children: [],
          version_number: 1,
        })}
      />,
    );

    expect(screen.getByLabelText(/no ratings yet/i)).toBeInTheDocument();
    expect(screen.getByText("Original", { selector: ".eyebrow" })).toBeInTheDocument();
    expect(screen.getByText(/does not have another version yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /see what changed/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /based on/i })).not.toBeInTheDocument();
    const lineage = screen.getByRole("list", { name: /more versions of this recipe/i });
    expect(within(lineage).getAllByRole("listitem")).toHaveLength(1);
    expect(within(lineage).getByLabelText(/current recipe version/i)).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("resets demo interaction state when navigation changes the recipe version", () => {
    const initialRecipe = detail();
    const { rerender } = render(<RecipeDetailView recipe={initialRecipe} />);

    fireEvent.click(screen.getByRole("radio", { name: /5 stars/i }));
    expect(screen.getByRole("radio", { name: /5 stars/i })).toBeChecked();

    rerender(
      <RecipeDetailView
        recipe={detail({
          id: "carrot-v3",
          viewer_state: {
            ...initialRecipe.viewer_state,
            recipe_version_id: "carrot-v3",
            saved: true,
            rating: 3,
          },
        })}
      />,
    );

    expect(screen.getByRole("button", { name: /remove saved recipe/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("radio", { name: /3 stars/i })).toBeChecked();
    expect(screen.getByRole("radio", { name: /5 stars/i })).not.toBeChecked();
  });
});
