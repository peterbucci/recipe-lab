import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import MyIngredientRequestsLoading from "./ingredient-requests/loading";
import RecipeDraftsLoading from "./recipe-drafts/loading";
import MyRecipesLoading from "./recipes/loading";
import SavedRecipesLoading from "./saved-recipes/loading";

describe("private account loading states", () => {
  it.each([
    [MyRecipesLoading, "account-recipes-page", "Loading your recipes", "My recipes"],
    [RecipeDraftsLoading, "account-recipes-page", "Loading your private drafts", "My recipes"],
    [SavedRecipesLoading, "account-saved-recipes-page", "Loading your saved recipes", "My recipes"],
    [
      MyIngredientRequestsLoading,
      "account-ingredient-requests-page",
      "Loading ingredient requests",
      "Ingredient Requests",
    ],
  ] as const)(
    "keeps %s inside a destination-shaped account workspace",
    (LoadingState, pageClass, message, title) => {
      render(<LoadingState />);

      expect(screen.getByRole("main")).toHaveClass(
        "page-loading--member",
        "account-workspace-page",
        pageClass,
      );
      expect(screen.getByText(title)).toBeVisible();
      expect(screen.getAllByRole("status")).toHaveLength(1);
      expect(screen.getByRole("status")).toHaveTextContent(message);
      expect(document.querySelector(".loading-state__pulse")).toBeNull();
    },
  );
});
