import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import IngredientRequestReviewLoading from "./catalog/ingredient-requests/loading";
import RecipeModerationLoading from "./moderation/recipes/loading";

describe("staff route states", () => {
  it("uses the shared staff skeleton for catalog curation", () => {
    render(<IngredientRequestReviewLoading />);

    expect(screen.getByRole("main")).toHaveClass(
      "page-loading--staff",
      "staff-workspace--curation",
      "curation-page",
    );
    expect(screen.getByText("Ingredient requests")).toBeVisible();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading ingredient request review…",
    );
  });

  it("uses the shared staff skeleton for recipe moderation", () => {
    render(<RecipeModerationLoading />);

    expect(screen.getByRole("main")).toHaveClass(
      "page-loading--staff",
      "staff-workspace--moderation",
      "moderation-workspace",
    );
    expect(screen.getByText("Recipe reports")).toBeVisible();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading recipe moderation…",
    );
    expect(document.querySelector(".loading-state__pulse")).toBeNull();
  });
});
