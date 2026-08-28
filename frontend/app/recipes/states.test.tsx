import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import RootNotFound from "../not-found";
import RecipeCompareError from "./[recipeVersionId]/compare/error";
import RecipeCompareLoading from "./[recipeVersionId]/compare/loading";
import RecipeCompareNotFound from "./[recipeVersionId]/compare/not-found";
import RecipeDetailError from "./[recipeVersionId]/error";
import RecipeNotFound from "./[recipeVersionId]/not-found";
import RecipeDetailLoading from "./[recipeVersionId]/loading";
import RecipeError from "./error";
import RecipeBrowseLoading from "./loading";

describe("recipe route states", () => {
  it("announces browse and detail loading states", () => {
    const { rerender } = render(<RecipeBrowseLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading recipes/i);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading the recipe list.",
    );

    rerender(<RecipeDetailLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading recipe/i);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading ingredients and instructions.",
    );

    rerender(<RecipeCompareLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(/loading comparison/i);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking what changed in the ingredients and cooking steps.",
    );
  });

  it("offers a retry for service errors", () => {
    const reset = vi.fn();
    render(<RecipeError error={new Error("upstream detail")} reset={reset} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn’t load the recipes/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.queryByText(/upstream detail/i)).not.toBeInTheDocument();
  });

  it("offers recipe-detail recovery without exposing service details", () => {
    const reset = vi.fn();
    render(
      <RecipeDetailError
        error={new Error("private recipe service detail")}
        reset={reset}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn’t load this recipe/i,
    );
    expect(screen.getByText(/temporarily unavailable/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /browse recipes/i }),
    ).toHaveAttribute("href", "/recipes");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
    expect(
      screen.queryByText(/private recipe service detail/i),
    ).not.toBeInTheDocument();
  });

  it("offers a comparison retry without exposing service details", () => {
    const retry = vi.fn();
    render(
      <RecipeCompareError
        error={new Error("private diff service detail")}
        retry={retry}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      /couldn’t load this comparison/i,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "This comparison may be temporarily unavailable.",
    );
    expect(
      screen.getByRole("link", { name: /browse recipes/i }),
    ).toHaveAttribute("href", "/recipes");
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(
      screen.queryByText(/private diff service detail/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/recipe service|catalog/i),
    ).not.toBeInTheDocument();
  });

  it("gives an unavailable comparison its own safe routes away", () => {
    render(<RecipeCompareNotFound />);

    expect(
      screen.getByRole("heading", { name: "This comparison isn’t available." }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Browse recipes" }),
    ).toHaveAttribute("href", "/recipes");
    expect(screen.getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      screen.queryByText(/service|catalog|identifier/i),
    ).not.toBeInTheDocument();
  });

  it("uses the same neutral unavailable state for every opaque recipe miss", () => {
    render(<RecipeNotFound />);

    expect(
      screen.getByRole("heading", { name: "This recipe isn’t available." }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/withdraw|moderation|hidden|moved/i)).toBeNull();
    expect(
      screen.getByRole("link", { name: /browse recipes/i }),
    ).toHaveAttribute("href", "/recipes");
  });

  it("gives a missing page a plain-language route back to recipes", () => {
    render(<RootNotFound />);

    expect(
      screen.getByRole("heading", { name: "We couldn’t find that page." }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Browse the recipes to find something to cook."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /browse recipes/i }),
    ).toHaveAttribute("href", "/recipes");
  });
});
