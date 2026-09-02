import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecipeCatalogFilters } from "./recipe-catalog-filters";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

describe("RecipeCatalogFilters", () => {
  beforeEach(() => {
    push.mockReset();
  });

  it("uses one sort dropdown while preserving active filters", () => {
    render(
      <RecipeCatalogFilters
        category="breakfast"
        query="oats"
        recipeType="versions"
        sort="newest"
      />,
    );

    expect(
      screen.queryByRole("combobox", { name: "Recipe type" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Sort recipes" })).toHaveValue(
      "newest",
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Sort recipes" }), {
      target: { value: "title" },
    });
    expect(push).toHaveBeenLastCalledWith(
      "/recipes?q=oats&category=breakfast&type=versions&sort=title",
    );
  });

  it("sorts the unfiltered recipe collection without adding a type query", () => {
    render(
      <RecipeCatalogFilters
        query=""
        sort="newest"
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Sort recipes" }), {
      target: { value: "title" },
    });
    expect(push).toHaveBeenCalledWith("/recipes?sort=title");
  });
});
