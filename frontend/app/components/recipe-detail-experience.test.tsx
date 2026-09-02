import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeDetail } from "../../lib/recipe-api";
import type { RecipeDraftEditorEntry } from "../../lib/recipe-draft-editor-entry";
import { RecipeDetailExperience } from "./recipe-detail-experience";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const entry = {
  actionTypes: [],
  categories: [],
  detail: {
    id: DRAFT_ID,
    title: "My banana pancakes",
  },
  measurementUnits: [],
} as unknown as RecipeDraftEditorEntry;

vi.mock("./recipe-detail-view", () => ({
  RecipeDetailView: ({
    onActiveDraftChange,
    onEditableVersionReady,
    recipe,
  }: {
    onActiveDraftChange?: (hasActiveDraft: boolean) => void;
    onEditableVersionReady: (entry: RecipeDraftEditorEntry) => void;
    recipe: RecipeDetail;
  }) => (
    <article className="recipe-detail">
      <h1>{recipe.title}</h1>
      <p>Public ingredients stay here while preparation runs.</p>
      <button type="button" onClick={() => onEditableVersionReady(entry)}>
        Finish preparation
      </button>
      <button type="button" onClick={() => onActiveDraftChange?.(true)}>
        Find active version
      </button>
    </article>
  ),
}));

vi.mock("./recipe-draft-editor", () => ({
  RecipeDraftEditor: ({
    familyRecipe,
    familyVersions,
    initialDetail,
    onDoneForNow,
  }: {
    familyRecipe: RecipeDetail;
    familyVersions: unknown[];
    initialDetail: { title: string };
    onDoneForNow: () => void;
  }) => (
    <form aria-label="Private recipe draft editor">
      <p>Family source: {familyRecipe.title}</p>
      <p>Family versions: {familyVersions.length}</p>
      <label>
        Recipe title
        <input value={initialDetail.title} readOnly />
      </label>
      <button type="button" onClick={onDoneForNow}>
        Return
      </button>
    </form>
  ),
}));

const recipe = {
  id: SOURCE_ID,
  title: "Banana oat pancakes",
  parent: null,
} as RecipeDetail;

describe("RecipeDetailExperience", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", `/recipes/${SOURCE_ID}`);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("swaps directly from the intact recipe to the prepared editor with no loading view", () => {
    const scrollTo = vi.mocked(window.scrollTo);
    Object.defineProperty(window, "scrollX", { configurable: true, value: 4 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 36 });
    const { container } = render(
      <RecipeDetailExperience familyVersions={[]} recipe={recipe} />,
    );

    const readingShell = container.querySelector("main.recipe-reading-page");
    expect(readingShell).not.toBeNull();

    expect(
      screen.getByRole("heading", { name: "Banana oat pancakes" }),
    ).toBeVisible();
    expect(
      screen.getByText("Public ingredients stay here while preparation runs."),
    ).toBeVisible();
    expect(screen.queryByText(/opening your recipe/i)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Finish preparation" }));

    expect(
      screen.getByRole("form", { name: "Private recipe draft editor" }),
    ).toBeVisible();
    expect(container.querySelector("main.recipe-reading-page")).toBe(
      readingShell,
    );
    expect(scrollTo).toHaveBeenLastCalledWith(4, 36);
    expect(screen.getByLabelText("Recipe title")).toHaveValue(
      "My banana pancakes",
    );
    expect(screen.queryByText(/opening your recipe/i)).toBeNull();
    expect(window.location.pathname).toBe(`/recipes/${SOURCE_ID}`);
    expect(
      screen.getByText("Family source: Banana oat pancakes"),
    ).toBeVisible();
    expect(screen.getByText("Family versions: 0")).toBeVisible();
  });

  it("returns directly to the source recipe when editing is done for now", () => {
    render(<RecipeDetailExperience familyVersions={[]} recipe={recipe} />);
    fireEvent.click(screen.getByRole("button", { name: "Finish preparation" }));

    fireEvent.click(screen.getByRole("button", { name: "Return" }));

    expect(window.location.pathname).toBe(`/recipes/${SOURCE_ID}`);
    expect(
      screen.getByRole("heading", { name: "Banana oat pancakes" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("form", { name: "Private recipe draft editor" }),
    ).toBeNull();
  });

  it("links an existing version back to My recipes from the source breadcrumb", () => {
    render(<RecipeDetailExperience familyVersions={[]} recipe={recipe} />);
    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });

    expect(within(breadcrumb).getByRole("link", { name: "Explore" })).toHaveAttribute(
      "href",
      "/recipes",
    );

    fireEvent.click(screen.getByRole("button", { name: "Find active version" }));

    expect(within(breadcrumb).queryByRole("link", { name: "Explore" })).toBeNull();
    expect(within(breadcrumb).getByRole("link", { name: "My recipes" })).toHaveAttribute(
      "href",
      "/account/recipes?view=drafts",
    );
    expect(within(breadcrumb).getByText("Banana oat pancakes")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
