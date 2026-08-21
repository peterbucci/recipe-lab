import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RecipeNotFound from "./[recipeVersionId]/not-found";
import RecipeDetailLoading from "./[recipeVersionId]/loading";
import RecipeError from "./error";
import RecipeBrowseLoading from "./loading";

describe("recipe route states", () => {
  it("announces browse and detail loading states", () => {
    const { rerender } = render(<RecipeBrowseLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading recipes/i);

    rerender(<RecipeDetailLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading recipe/i);
  });

  it("offers a retry for service errors", () => {
    const reset = vi.fn();
    render(<RecipeError error={new Error("upstream detail")} reset={reset} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t load the recipes/i);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.queryByText(/upstream detail/i)).not.toBeInTheDocument();
  });

  it("gives a missing recipe a route back to the catalog", () => {
    render(<RecipeNotFound />);

    expect(screen.getByRole("heading", { name: /isn’t in the catalog/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse recipes/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });
});
