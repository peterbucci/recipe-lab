import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RecipeDetail } from "../../lib/recipe-api";
import { RecipeDetailView } from "./recipe-detail-view";

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
  it("shows the structured recipe, aggregate rating, and direct lineage links", () => {
    render(<RecipeDetailView recipe={detail()} />);

    expect(
      screen.getByRole("heading", { name: /lower-sugar pecan carrot cake/i, level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/4\.5 out of 5 from 2 ratings/i)).toBeInTheDocument();
    expect(screen.getByText("140 g")).toBeInTheDocument();
    expect(screen.getByText("White sugar")).toBeInTheDocument();
    expect(screen.getByText(/catalog name: granulated sugar/i)).toBeInTheDocument();
    expect(screen.getByText("divided")).toBeInTheDocument();
    expect(screen.getByText(/amount not specified/i)).toBeInTheDocument();

    const instructions = screen.getByRole("heading", { name: /instructions/i }).closest("section");
    expect(instructions).not.toBeNull();
    expect(within(instructions!).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Heat the oven and prepare the pan.",
      "Fold the dry ingredients into the wet mixture.",
    ]);

    expect(screen.getByRole("link", { name: /parent.*carrot walnut snack cake/i })).toHaveAttribute(
      "href",
      "/recipes/carrot-v1",
    );
    expect(screen.getByRole("link", { name: /direct child.*orange raisin carrot cake/i })).toHaveAttribute(
      "href",
      "/recipes/carrot-v3",
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
    expect(screen.getByText(/does not have a direct variant yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /parent/i })).not.toBeInTheDocument();
  });
});
