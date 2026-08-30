import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MyIngredientRequestsLoading from "./ingredient-requests/loading";
import MyRecipesLoading from "./recipes/loading";
import SavedRecipesLoading from "./saved-recipes/loading";

describe("private account loading states", () => {
  it.each([
    [MyRecipesLoading, "account-recipes-page", "Loading your recipes"],
    [SavedRecipesLoading, "account-saved-recipes-page", "Loading your saved recipes"],
    [
      MyIngredientRequestsLoading,
      "account-ingredient-requests-page",
      "Loading your ingredient requests",
    ],
  ] as const)("keeps %s inside its account workspace", (LoadingState, pageClass, message) => {
    render(<LoadingState />);

    expect(screen.getByRole("main")).toHaveClass("account-workspace-page", pageClass);
    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(screen.getByRole("status")).toHaveAttribute("aria-live", "polite");
  });
});
