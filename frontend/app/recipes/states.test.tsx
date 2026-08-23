import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RootNotFound from "../not-found";
import RecipeCompareError from "./[recipeVersionId]/compare/error";
import RecipeCompareLoading from "./[recipeVersionId]/compare/loading";
import RecipeNotFound from "./[recipeVersionId]/not-found";
import RecipeDetailLoading from "./[recipeVersionId]/loading";
import RecipeError from "./error";
import RecipeBrowseLoading from "./loading";

describe("recipe route states", () => {
  it("announces browse and detail loading states", () => {
    const { rerender } = render(<RecipeBrowseLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading recipes/i);
    expect(screen.getByRole("status")).toHaveTextContent("Loading the recipe list.");

    rerender(<RecipeDetailLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading recipe/i);
    expect(screen.getByRole("status")).toHaveTextContent("Loading ingredients and instructions.");

    rerender(<RecipeCompareLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading comparison/i);
  });

  it("offers a retry for service errors", () => {
    const reset = vi.fn();
    render(<RecipeError error={new Error("upstream detail")} reset={reset} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t load the recipes/i);
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.queryByText(/upstream detail/i)).not.toBeInTheDocument();
  });

  it("offers a comparison retry without exposing service details", () => {
    const retry = vi.fn();
    render(<RecipeCompareError error={new Error("private diff service detail")} retry={retry} />);

    expect(screen.getByRole("alert")).toHaveTextContent(/couldn’t load this comparison/i);
    expect(screen.getByRole("link", { name: /browse recipes/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByText(/private diff service detail/i)).not.toBeInTheDocument();
  });

  it("gives a missing recipe a route back to the collection", () => {
    render(<RecipeNotFound />);

    expect(
      screen.getByRole("heading", { name: /isn’t in the collection/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse recipes/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });

  it("gives a missing page a plain-language route back to recipes", () => {
    render(<RootNotFound />);

    expect(
      screen.getByRole("heading", { name: "We couldn’t find that page." }),
    ).toBeInTheDocument();
    expect(screen.getByText("Browse the recipes to find something to cook.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse recipes/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });
});
