import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import IngredientRequestReviewLoading from "./catalog/ingredient-requests/loading";
import RecipeModerationLoading from "./moderation/recipes/loading";

describe("staff route states", () => {
  it("scopes catalog-curator loading without changing its role-specific copy", () => {
    render(<IngredientRequestReviewLoading />);

    expect(screen.getByRole("main")).toHaveClass(
      "staff-state-page",
      "staff-state-page--curation",
      "staff-state-page--loading",
    );
    expect(screen.getByRole("status")).toHaveClass("staff-state-panel");
    expect(screen.getByText("Checking catalog-curator access.")).toBeVisible();
  });

  it("scopes recipe-moderator loading without merging the roles", () => {
    render(<RecipeModerationLoading />);

    expect(screen.getByRole("main")).toHaveClass(
      "staff-state-page",
      "staff-state-page--moderation",
      "staff-state-page--loading",
    );
    expect(screen.getByRole("status")).toHaveClass("staff-state-panel");
    expect(screen.getByText("Checking recipe-moderator access.")).toBeVisible();
    expect(screen.queryByText("Checking catalog-curator access.")).not.toBeInTheDocument();
  });
});
