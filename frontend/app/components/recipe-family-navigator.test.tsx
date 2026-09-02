import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type {
  RecipeCardSummary,
  RecipeDetail,
  RecipeVersionReference,
} from "../../lib/recipe-api";
import { RecipeFamilyNavigator } from "./recipe-family-navigator";

const authors = {
  maya: { id: "maya", display_name: "Maya Chen", handle: "maya-chen" },
  catalog: {
    id: "catalog",
    display_name: "Recipe Lab Demo Catalog",
    handle: "recipe-lab-catalog",
  },
  lena: { id: "lena", display_name: "Lena Ortiz", handle: "lena-ortiz" },
  avery: { id: "avery", display_name: "Avery Kim", handle: "avery-kim" },
  jordan: {
    id: "jordan",
    display_name: "Jordan Bell",
    handle: "jordan-bell",
  },
  priya: { id: "priya", display_name: "Priya Shah", handle: "priya-shah" },
} as const;

function reference(
  id: string,
  versionNumber: number,
  title: string,
  author: RecipeDetail["author"],
): RecipeVersionReference {
  return {
    id,
    version_number: versionNumber,
    title,
    author,
  };
}

function summary({
  author,
  id,
  parent,
  saveCount,
  title,
  versionNumber,
}: {
  author: RecipeDetail["author"];
  id: string;
  parent: RecipeVersionReference | null;
  saveCount: number;
  title: string;
  versionNumber: number;
}): RecipeCardSummary {
  return {
    id,
    lineage_id: "pancake-family",
    parent_version_id: parent?.id ?? null,
    version_number: versionNumber,
    title,
    description: null,
    servings: "4.00",
    created_at: "2026-08-20T00:00:00Z",
    published_at: "2026-08-21T00:00:00Z",
    author,
    parent,
    categories: [],
    average_rating: null,
    rating_count: 0,
    save_count: saveCount,
  };
}

const root = reference(
  "classic",
  1,
  "Classic Banana Oat Pancakes",
  authors.maya,
);
const banana = reference("banana", 3, "Banana Oat Pancakes", authors.catalog);

const versions = [
  summary({
    id: root.id,
    title: root.title,
    versionNumber: root.version_number,
    author: root.author,
    parent: null,
    saveCount: 812,
  }),
  summary({
    id: banana.id,
    title: banana.title,
    versionNumber: banana.version_number,
    author: banana.author,
    parent: root,
    saveCount: 187,
  }),
  summary({
    id: "blueberry",
    title: "Blueberry Banana Oat Pancakes",
    versionNumber: 2,
    author: authors.lena,
    parent: root,
    saveCount: 124,
  }),
  summary({
    id: "protein",
    title: "Protein Banana Oat Pancakes",
    versionNumber: 4,
    author: authors.avery,
    parent: root,
    saveCount: 96,
  }),
  summary({
    id: "pecan",
    title: "Pecan Banana Oat Pancakes",
    versionNumber: 5,
    author: authors.jordan,
    parent: banana,
    saveCount: 49,
  }),
  summary({
    id: "strawberry",
    title: "Strawberry Banana Oat Pancakes",
    versionNumber: 6,
    author: authors.priya,
    parent: banana,
    saveCount: 72,
  }),
];

function recipe(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    ...versions[1],
    total_time_minutes: 25,
    active_time_minutes: 15,
    difficulty: "easy",
    notes: null,
    viewer_state: null,
    children: [
      reference("pecan", 5, "Pecan Banana Oat Pancakes", authors.jordan),
      reference(
        "strawberry",
        6,
        "Strawberry Banana Oat Pancakes",
        authors.priya,
      ),
    ],
    ingredients: [],
    instructions: [],
    ...overrides,
  };
}

describe("RecipeFamilyNavigator", () => {
  it("keeps tree selection separate from recipe-title navigation", () => {
    render(<RecipeFamilyNavigator recipe={recipe()} versions={versions} />);

    const family = screen.getByRole("region", { name: "Recipe family" });
    expect(within(family).getByText("Generation 2 · Version 3")).toBeVisible();
    expect(
      within(family).queryByText("Family origin", { exact: true }),
    ).toBeNull();
    expect(
      within(family).getByRole("button", {
        name: "Show Classic Banana Oat Pancakes in the family tree",
      }),
    ).toBeVisible();
    expect(
      within(family).getByRole("button", {
        name: "Show Blueberry Banana Oat Pancakes in the family tree",
      }),
    ).toBeVisible();
    expect(
      within(family).getByRole("button", {
        name: "Show Protein Banana Oat Pancakes in the family tree",
      }),
    ).toBeVisible();
    const current = within(family).getByLabelText(
      "Selected family recipe: Banana Oat Pancakes",
    );
    expect(current).toHaveTextContent("187 saves");
    expect(
      within(current).getByRole("link", {
        name: "Banana Oat Pancakes",
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      within(family).getByRole("button", {
        name: "Show Pecan Banana Oat Pancakes in the family tree",
      }),
    ).toBeVisible();
    expect(
      within(family).getByRole("link", {
        name: "Pecan Banana Oat Pancakes",
      }),
    ).toHaveAttribute("href", "/recipes/pecan");
  });

  it("recenters in place and compares the selection with the open recipe", () => {
    render(<RecipeFamilyNavigator recipe={recipe()} versions={versions} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show Pecan Banana Oat Pancakes in the family tree",
      }),
    );

    const selected = screen.getByLabelText(
      "Selected family recipe: Pecan Banana Oat Pancakes",
    );
    expect(
      within(selected).getByRole("link", {
        name: "Pecan Banana Oat Pancakes",
      }),
    ).toHaveAttribute("href", "/recipes/pecan");
    expect(
      screen.getByRole("link", { name: "Banana Oat Pancakes" }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      screen.getByRole("link", {
        name: "Compare with Banana Oat Pancakes →",
      }),
    ).toHaveAttribute("href", "/recipes/pecan/compare?base_version_id=banana");
  });

  it("lets the family origin recenter the tree while its title opens it", () => {
    render(
      <RecipeFamilyNavigator
        recipe={recipe({ ...versions[4], children: [] })}
        versions={versions}
      />,
    );

    expect(
      screen.getByLabelText(
        "Selected family recipe: Pecan Banana Oat Pancakes",
      ),
    ).toBeVisible();
    expect(screen.getAllByText("Family origin", { exact: true })).toHaveLength(
      2,
    );
    expect(
      screen.getByRole("button", {
        name: "Show Classic Banana Oat Pancakes in the family tree",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Classic Banana Oat Pancakes" }),
    ).toHaveAttribute("href", "/recipes/classic");
    expect(
      screen.getByRole("button", {
        name: "Show Banana Oat Pancakes in the family tree",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Banana Oat Pancakes" }),
    ).toHaveAttribute("href", "/recipes/banana");
    expect(
      screen.getByRole("button", {
        name: "Show Strawberry Banana Oat Pancakes in the family tree",
      }),
    ).toBeVisible();
    expect(
      screen.getByText("No versions have been created from this recipe yet."),
    ).toBeVisible();
  });

  it("keeps an unavailable parent private while preserving the current branch", () => {
    render(
      <RecipeFamilyNavigator
        recipe={recipe({ parent: null, children: [] })}
        versions={[]}
      />,
    );

    expect(screen.getByText("Source unavailable")).toBeVisible();
    expect(screen.queryByText("Classic Banana Oat Pancakes")).toBeNull();
    expect(
      screen.getByLabelText("Selected family recipe: Banana Oat Pancakes"),
    ).toBeVisible();
  });

  it("selects the current draft first and lets it be recentered", () => {
    render(
      <RecipeFamilyNavigator
        draftPreview={{
          authorDisplayName: "Peter",
          id: "private-draft",
          parentVersionId: banana.id,
          title: "My banana oat pancakes",
        }}
        recipe={recipe()}
        versions={versions}
      />,
    );

    const family = screen.getByRole("region", { name: "Recipe family" });
    const selectedDraft = within(family).getByLabelText(
      "Selected current draft: My banana oat pancakes",
    );
    expect(selectedDraft).toHaveAttribute("aria-current", "page");
    expect(selectedDraft).toHaveTextContent("Current draft");
    expect(selectedDraft).toHaveTextContent("Selected");
    expect(selectedDraft).toHaveTextContent("Would become a version");
    expect(selectedDraft).toHaveTextContent("Not published");
    expect(within(selectedDraft).queryByRole("link")).toBeNull();
    expect(
      within(family).getByText("Current draft", {
        selector: ".recipe-family-nav__position",
      }),
    ).toBeVisible();
    expect(
      within(family).getByRole("button", {
        name: "Show Banana Oat Pancakes in the family tree",
      }),
    ).toBeVisible();
    expect(
      within(family).getByRole("link", { name: "Banana Oat Pancakes" }),
    ).not.toHaveAttribute("aria-current");

    fireEvent.click(
      within(family).getByRole("button", {
        name: "Show Banana Oat Pancakes in the family tree",
      }),
    );

    expect(
      within(family).getByLabelText(
        "Selected family recipe: Banana Oat Pancakes",
      ),
    ).toBeVisible();
    expect(
      within(family).getByText("3", {
        selector: ".recipe-family-nav__children-count",
      }),
    ).toBeVisible();
    const draftSelector = within(family).getByRole("button", {
      name: "Show current draft My banana oat pancakes in the family tree",
    });
    expect(draftSelector.closest("article")).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.click(draftSelector);

    expect(
      within(family).getByLabelText(
        "Selected current draft: My banana oat pancakes",
      ),
    ).toBeVisible();
  });
});
