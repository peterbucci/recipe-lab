import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecipeArtwork } from "./recipe-artwork";

describe("RecipeArtwork", () => {
  it("renders the default plate illustration with a stable palette per recipe", () => {
    const { container } = render(
      <>
        <RecipeArtwork className="first-artwork" recipeKey="recipe-a" />
        <RecipeArtwork className="same-recipe-artwork" recipeKey="recipe-a" />
        <RecipeArtwork className="different-recipe-artwork" recipeKey="recipe-b" />
      </>,
    );

    const first = container.querySelector<HTMLElement>(".first-artwork");
    const sameRecipe = container.querySelector<HTMLElement>(".same-recipe-artwork");
    const differentRecipe = container.querySelector<HTMLElement>(
      ".different-recipe-artwork",
    );

    expect(first).toHaveAttribute("aria-hidden", "true");
    expect(first).toHaveAttribute(
      "data-artwork-variant",
      sameRecipe?.getAttribute("data-artwork-variant"),
    );
    expect(first?.getAttribute("data-artwork-variant")).not.toBe(
      differentRecipe?.getAttribute("data-artwork-variant"),
    );
    expect(Number(first?.getAttribute("data-artwork-variant"))).toBeLessThan(8);

    expect(first?.querySelector(".recipe-artwork__plate-shadow")).toBeInTheDocument();
    expect(first?.querySelector(".recipe-artwork__plate")).toBeInTheDocument();
    expect(first?.querySelector(".recipe-artwork__plate-inner")).toBeInTheDocument();
    expect(first?.querySelector(".recipe-artwork__food--red")).toBeInTheDocument();
    expect(first?.querySelector(".recipe-artwork__food--orange")).toBeInTheDocument();
    expect(first?.querySelector(".recipe-artwork__food--lime")).toBeInTheDocument();
    expect(first?.querySelectorAll(".recipe-artwork__segment")).toHaveLength(8);
    expect(first?.querySelector("svg")).not.toBeInTheDocument();
  });
});
