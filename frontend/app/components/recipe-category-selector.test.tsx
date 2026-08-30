import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeCategory } from "../../lib/recipe-api";
import { RecipeCategorySelector } from "./recipe-category-selector";

const mocks = vi.hoisted(() => ({
  fetchActiveRecipeCategories: vi.fn(),
}));

vi.mock("../../lib/recipe-category-client-api", () => ({
  fetchActiveRecipeCategories: mocks.fetchActiveRecipeCategories,
}));

const categories: RecipeCategory[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Breakfast",
    slug: "breakfast",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    name: "Lunch",
    slug: "lunch",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    name: "Dinner",
    slug: "dinner",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    name: "Dessert",
    slug: "dessert",
  },
];

function Harness({ initial = [] }: { initial?: RecipeCategory[] }) {
  const [value, setValue] = useState(initial);
  return (
    <RecipeCategorySelector onChange={setValue} value={value} />
  );
}

describe("RecipeCategorySelector", () => {
  beforeEach(() => {
    mocks.fetchActiveRecipeCategories.mockReset().mockResolvedValue({
      items: categories,
    });
  });

  it("loads only curated checkboxes and enforces the three-category limit", async () => {
    render(<Harness />);

    const breakfast = await screen.findByRole("checkbox", { name: "Breakfast" });
    const lunch = screen.getByRole("checkbox", { name: "Lunch" });
    const dinner = screen.getByRole("checkbox", { name: "Dinner" });
    const dessert = screen.getByRole("checkbox", { name: "Dessert" });

    expect(screen.getByRole("group", { name: "Curated recipe categories" })).toBeVisible();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    fireEvent.click(breakfast);
    fireEvent.click(lunch);
    fireEvent.click(dinner);

    expect(breakfast).toBeChecked();
    expect(lunch).toBeChecked();
    expect(dinner).toBeChecked();
    expect(dessert).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "3 of 3 categories selected. Clear one selection before choosing another.",
    );

    fireEvent.click(lunch);
    expect(dessert).toBeEnabled();
    fireEvent.click(dessert);
    expect(dessert).toBeChecked();
    expect(lunch).not.toBeChecked();
  });

  it("keeps a saved inactive selection through load failure and supports retry", async () => {
    const inactive = {
      id: "55555555-5555-4555-8555-555555555555",
      name: "Seasonal",
      slug: "seasonal",
    };
    mocks.fetchActiveRecipeCategories
      .mockRejectedValueOnce(new Error("private upstream detail"))
      .mockResolvedValueOnce({ items: categories });

    render(<Harness initial={[inactive]} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your existing selections are still here.",
    );
    const inactiveChoice = screen.getByRole("checkbox", {
      name: /Seasonal.*Saved selection; availability not confirmed/i,
    });
    expect(inactiveChoice).toBeChecked();
    expect(inactiveChoice).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Try loading categories again" }));
    await waitFor(() =>
      expect(screen.getByRole("checkbox", { name: "Breakfast" })).toBeVisible(),
    );
    expect(
      screen.getByRole("checkbox", {
        name: /Seasonal.*Previously selected; no longer available/i,
      }),
    ).toBeChecked();
    expect(mocks.fetchActiveRecipeCategories).toHaveBeenCalledTimes(2);
  });
});
