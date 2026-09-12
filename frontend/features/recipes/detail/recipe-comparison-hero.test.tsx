import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RecipeDiff } from "../shared/recipe-contracts";
import {
  baseVersion,
  comparisonModel,
  mixedDiff,
  targetRecipeDetail,
} from "./recipe-diff-view-test-support";
import { RecipeComparisonHero } from "./recipe-comparison-hero";

function renderComparisonHero(diff = mixedDiff()) {
  const comparison = comparisonModel(diff);
  return render(
    <RecipeComparisonHero
      comparison={comparison}
      headingId="comparison-heading"
    />,
  );
}

describe("RecipeComparisonHero", () => {
  it("keeps the current recipe authoritative while showing structured prior values and the true source", () => {
    const diff = mixedDiff();
    diff.metadata_changes = [
      {
        field: "title",
        before: "Earlier carrot cake",
        after: "A stale target title",
      },
      {
        field: "description",
        before: "A richer original with walnuts.",
        after: "A stale target description.",
      },
      { field: "total_time_minutes", before: 75, after: 95 },
      { field: "active_time_minutes", before: 30, after: 25 },
      { field: "servings", before: "8.0000", after: "6.0000" },
      { field: "difficulty", before: "medium", after: "hard" },
    ];
    const recipe = targetRecipeDetail(diff, {
      id: "current/recipe",
      version_number: 4,
      title: "Current authoritative carrot cake",
      description: "The recipe people can cook today.",
      total_time_minutes: 95,
      active_time_minutes: 25,
      servings: "6.0000",
      difficulty: "hard",
      categories: [
        { id: "baking", name: "Baking", slug: "baking" },
        { id: "dessert", name: "Dessert", slug: "dessert" },
      ],
      author: {
        id: "current-cook",
        handle: "current cook",
        display_name: "Current Cook",
      },
      parent_version_id: "source/recipe",
      parent: {
        id: "source/recipe",
        version_number: 3,
        title: "The actual source recipe",
        author: {
          id: "source-cook",
          handle: "source cook",
          display_name: "Source Cook",
        },
      },
    });
    const comparison = comparisonModel(diff, recipe);
    const { container } = render(
      <RecipeComparisonHero
        comparison={comparison}
        headingId="comparison-heading"
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Current authoritative carrot cake",
      }),
    ).toHaveAttribute("id", "comparison-heading");
    expect(screen.queryByText("A stale target title")).not.toBeInTheDocument();
    expect(
      screen.queryByText("A stale target description."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Version 4")).toBeVisible();
    expect(screen.getByText("Comparison view")).toBeVisible();
    expect(
      screen.getByText("The recipe people can cook today."),
    ).toBeVisible();

    const previousValues = Array.from(
      container.querySelectorAll<HTMLElement>(
        ".recipe-comparison-previous",
      ),
    );
    expect(previousValues.map((value) => value.textContent)).toEqual([
      "Previous titleEarlier carrot cake",
      "WasA richer original with walnuts.",
      "Was1 hr 15 min",
      "Was30 min",
      "Was8 servings",
      "WasMedium",
    ]);
    expect(previousValues.every((value) => value.querySelector("del"))).toBe(
      true,
    );

    const facts = screen.getByLabelText("Recipe facts");
    expect(within(facts).getByText("1 hr 35 min")).toBeVisible();
    expect(within(facts).getByText("25 min")).toBeVisible();
    expect(within(facts).getByText("6 servings")).toBeVisible();
    expect(within(facts).getByText("Hard")).toBeVisible();
    const categories = screen.getByRole("list", {
      name: "Categories for Current authoritative carrot cake",
    });
    expect(within(categories).getAllByRole("listitem")).toHaveLength(2);
    expect(within(categories).getByText("Baking")).toBeVisible();
    expect(within(categories).getByText("Dessert")).toBeVisible();

    const sourceContext = screen
      .getByText("The actual source recipe")
      .closest<HTMLElement>(".recipe-comparison-hero__parent-context");
    expect(sourceContext).not.toBeNull();
    expect(
      within(sourceContext!).getByRole("link", {
        name: "The actual source recipe",
      }),
    ).toHaveAttribute("href", "/recipes/source%2Frecipe");
    expect(
      within(sourceContext!).getByRole("link", { name: "Source Cook" }),
    ).toHaveAttribute("href", "/cooks/source%20cook");
    expect(sourceContext).not.toHaveTextContent(baseVersion.title);

    expect(
      screen.getByRole("link", { name: "Current Cook" }),
    ).toHaveAttribute("href", "/cooks/current%20cook");
    expect(container.querySelector(".recipe-comparison-hero__artwork")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      screen.getByText(`${baseVersion.title} · Version 1`),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "View starting recipe" }),
    ).toHaveAttribute("href", `/recipes/${baseVersion.id}`);
    expect(
      screen.getByRole("link", {
        name: "Back to Current authoritative carrot cake",
      }),
    ).toHaveAttribute("href", "/recipes/current%2Frecipe");

    expect(
      screen.queryByRole("button", {
        name: /save|rate|report|follow|make your own/i,
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", {
        name: /save|rate|report|follow|make your own/i,
      }),
    ).not.toBeInTheDocument();
  });

  it("states when a variation's source is unavailable without inventing source attribution", () => {
    const diff = mixedDiff();
    const recipe = targetRecipeDetail(diff, {
      parent_version_id: "missing-source",
      parent: null,
    });

    render(
      <RecipeComparisonHero
        comparison={comparisonModel(diff, recipe)}
        headingId="comparison-heading"
      />,
    );

    const sourceContext = screen
      .getByText("Source unavailable")
      .closest<HTMLElement>(".recipe-comparison-hero__parent-context");
    expect(sourceContext).not.toBeNull();
    expect(within(sourceContext!).queryByRole("link")).not.toBeInTheDocument();
    expect(sourceContext).not.toHaveTextContent(baseVersion.title);
    expect(sourceContext).not.toHaveTextContent(baseVersion.author.display_name);
    expect(
      screen.getByText(`${baseVersion.title} · Version 1`),
    ).toBeVisible();
  });

  it.each([
    { count: 0, expected: "0 changes" },
    { count: 1, expected: "1 change" },
    { count: 10, expected: "10 changes" },
  ])("uses exact count wording for $count structured changes", ({ count, expected }) => {
    const diff: RecipeDiff = mixedDiff();
    diff.metadata_changes = diff.metadata_changes.slice(0, Math.min(count, 3));
    const remainingIngredientChanges = Math.max(
      0,
      Math.min(count - diff.metadata_changes.length, 4),
    );
    diff.ingredients = {
      added: remainingIngredientChanges >= 1 ? diff.ingredients.added : [],
      removed: remainingIngredientChanges >= 2 ? diff.ingredients.removed : [],
      replaced:
        remainingIngredientChanges >= 3 ? diff.ingredients.replaced : [],
      modified:
        remainingIngredientChanges >= 4 ? diff.ingredients.modified : [],
    };
    const remainingInstructionChanges = Math.max(
      0,
      count - diff.metadata_changes.length - remainingIngredientChanges,
    );
    diff.instructions = {
      added: remainingInstructionChanges >= 1 ? diff.instructions.added : [],
      removed: remainingInstructionChanges >= 2 ? diff.instructions.removed : [],
      modified:
        remainingInstructionChanges >= 3 ? diff.instructions.modified : [],
    };

    const { container } = renderComparisonHero(diff);

    expect(
      container.querySelector(".recipe-comparison-strip__count"),
    ).toHaveTextContent(expected);
  });
});
