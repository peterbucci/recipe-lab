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

function elementBounds(top: number, bottom: number): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left: 0,
    right: 320,
    top,
    width: 320,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function Harness({ initial = [] }: { initial?: RecipeCategory[] }) {
  const [value, setValue] = useState(initial);
  return <RecipeCategorySelector onChange={setValue} value={value} />;
}

function RecipePresentationHarness({
  initial = [categories[0]],
}: {
  initial?: RecipeCategory[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <RecipeCategorySelector
      initialActiveCategories={categories}
      onChange={setValue}
      presentation="recipe"
      value={value}
    />
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

    expect(
      screen
        .getByText("Loading curated categories…")
        .closest(".section-loading--rows"),
    ).not.toBeNull();

    const breakfast = await screen.findByRole("checkbox", {
      name: "Breakfast",
    });
    const lunch = screen.getByRole("checkbox", { name: "Lunch" });
    const dinner = screen.getByRole("checkbox", { name: "Dinner" });
    const dessert = screen.getByRole("checkbox", { name: "Dessert" });

    expect(
      screen.getByRole("group", { name: "Curated recipe categories" }),
    ).toBeVisible();
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

    fireEvent.click(
      screen.getByRole("button", { name: "Try loading categories again" }),
    );
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

  it("opens recipe category editing as an anchored floating panel", async () => {
    render(<RecipePresentationHarness />);

    const trigger = screen.getByRole("button", { name: "Edit categories" });
    expect(trigger).toHaveTextContent("");
    expect(trigger.querySelector('svg[data-icon="menu"]')).not.toBeNull();
    expect(
      screen.queryByRole("dialog", { name: "Edit recipe categories" }),
    ).toBeNull();

    fireEvent.click(trigger);

    const panel = screen.getByRole("dialog", {
      name: "Edit recipe categories",
    });
    expect(panel).toHaveClass("recipe-workspace__category-choices");
    expect(panel).toHaveAttribute("data-placement", "below");
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const breakfast = screen.getByRole("checkbox", { name: "Breakfast" });
    expect(breakfast).toBeChecked();
    await waitFor(() => expect(breakfast).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    expect(
      screen.queryByRole("dialog", { name: "Edit recipe categories" }),
    ).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());

    fireEvent.click(trigger);

    const reopenedPanel = screen.getByRole("dialog", {
      name: "Edit recipe categories",
    });

    fireEvent.keyDown(reopenedPanel, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", { name: "Edit recipe categories" }),
    ).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("starts recipe category editing closed when no categories are selected", () => {
    render(<RecipePresentationHarness initial={[]} />);

    expect(screen.getByText("No categories yet")).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit categories" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(
      screen.queryByRole("dialog", { name: "Edit recipe categories" }),
    ).not.toBeInTheDocument();
  });

  it("opens the category panel above when it would overflow the viewport", async () => {
    vi.stubGlobal("innerHeight", 600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("recipe-workspace__category-toggle")) {
          return elementBounds(500, 540);
        }
        if (this.classList.contains("recipe-workspace__category-choices")) {
          return elementBounds(546, 806);
        }
        return elementBounds(0, 0);
      },
    );
    render(<RecipePresentationHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Edit categories" }));

    const panel = screen.getByRole("dialog", {
      name: "Edit recipe categories",
    });
    await waitFor(() =>
      expect(panel).toHaveAttribute("data-placement", "above"),
    );
    expect(panel.style.getPropertyValue("--floating-panel-max-height")).toBe(
      "478px",
    );
  });
});
