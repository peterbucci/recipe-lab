import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RecipeApiError } from "../../../../lib/recipe-api";
import RecipeComparePage from "./page";

const mocks = vi.hoisted(() => ({
  fetchRecipeDiff: vi.fn(),
}));

vi.mock("../../../../lib/recipe-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../../../lib/recipe-api")>();
  return { ...actual, fetchRecipeDiff: mocks.fetchRecipeDiff };
});

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";

describe("RecipeComparePage", () => {
  it("explains when a starting recipe has nothing earlier to compare", async () => {
    mocks.fetchRecipeDiff.mockRejectedValueOnce(
      new RecipeApiError(
        "private implementation detail",
        422,
        "recipe_has_no_parent",
      ),
    );

    render(
      await RecipeComparePage({
        params: Promise.resolve({ recipeVersionId: RECIPE_ID }),
      }),
    );

    expect(
      screen.getByRole("heading", {
        name: "There isn’t an earlier recipe to compare.",
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "This recipe wasn’t based on another recipe, so there are no earlier changes to show.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to recipe" }),
    ).toHaveAttribute("href", `/recipes/${RECIPE_ID}`);
    expect(
      screen.queryByText(/private implementation detail/i),
    ).not.toBeInTheDocument();
  });
});
