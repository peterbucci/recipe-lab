import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecipeDetail } from "./recipe-contracts";
import type { RecipeHistory, RecipeHistoryEntry } from "./recipe-history";
import { RecipeFamilyNavigator } from "./recipe-family-navigator";
import { buildRecipeSummary } from "./recipe-test-support";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const ADAPTATION = "33333333-3333-4333-8333-333333333333";
const STABLE = "44444444-4444-4444-8444-444444444444";
const ADAPTATION_STABLE = "55555555-5555-4555-8555-555555555555";
const ADAPTATION_REVISION = "77777777-7777-4777-8777-777777777777";
const AUTHOR = {
  id: "66666666-6666-4666-8666-666666666666",
  display_name: "Maya Chen",
  handle: "maya-chen",
};

function entry(overrides: Partial<RecipeHistoryEntry>): RecipeHistoryEntry {
  return {
    adaptation_source_version_id: null,
    author: AUTHOR,
    declared_change_reason: null,
    edition_number: 1,
    id: FIRST,
    is_current: false,
    previous_version_id: null,
    published_at: "2026-08-20T12:00:00Z",
    recipe_id: STABLE,
    relation_kind: "original",
    title: "Banana oat pancakes",
    ...overrides,
  };
}

function recipe(): RecipeDetail {
  return {
    ...buildRecipeSummary({
      current_version: {
        id: SECOND,
        title: "Banana oat pancakes, updated",
        version_number: 2,
        author: AUTHOR,
      },
      declared_change_reason: "correction",
      edition_number: 2,
      id: SECOND,
      is_current: true,
      previous_version_id: FIRST,
      recipe_id: STABLE,
      relation_kind: "revision",
      title: "Banana oat pancakes, updated",
      author: AUTHOR,
    }),
    active_time_minutes: 10,
    average_rating: null,
    children: [],
    difficulty: "easy",
    ingredients: [],
    instructions: [],
    notes: null,
    rating_count: 0,
    save_count: 0,
    total_time_minutes: 20,
    viewer_state: null,
  };
}

function history(overrides: Partial<RecipeHistory> = {}): RecipeHistory {
  return {
    adaptations: [
      entry({
        adaptation_source_version_id: FIRST,
        edition_number: 2,
        id: ADAPTATION,
        is_current: true,
        previous_version_id: "77777777-7777-4777-8777-777777777777",
        recipe_id: ADAPTATION_STABLE,
        relation_kind: "revision",
        title: "Blueberry banana pancakes",
      }),
    ],
    adaptations_truncated: false,
    current_version_id: SECOND,
    editions: [
      entry({}),
      entry({
        declared_change_reason: "correction",
        edition_number: 2,
        id: SECOND,
        is_current: true,
        previous_version_id: FIRST,
        relation_kind: "revision",
        title: "Banana oat pancakes, updated",
      }),
    ],
    editions_truncated: false,
    recipe_id: STABLE,
    selected_version_id: SECOND,
    ...overrides,
  };
}

function adaptedRecipe(
  overrides: Partial<RecipeDetail> = {},
): RecipeDetail {
  return {
    ...recipe(),
    adaptation_source: {
      author: AUTHOR,
      id: FIRST,
      title: "Banana oat pancakes",
      version_number: 1,
    },
    current_version: null,
    declared_change_reason: null,
    edition_number: 1,
    id: ADAPTATION,
    is_current: true,
    parent: null,
    parent_version_id: FIRST,
    previous_version_id: null,
    recipe_id: ADAPTATION_STABLE,
    relation_kind: "adaptation",
    title: "Blueberry banana pancakes",
    ...overrides,
  };
}

function adaptedHistory(): RecipeHistory {
  return {
    adaptations: [],
    adaptations_truncated: false,
    current_version_id: ADAPTATION_REVISION,
    editions: [
      entry({
        adaptation_source_version_id: FIRST,
        id: ADAPTATION,
        is_current: false,
        recipe_id: ADAPTATION_STABLE,
        relation_kind: "adaptation",
        title: "Blueberry banana pancakes",
      }),
      entry({
        adaptation_source_version_id: FIRST,
        declared_change_reason: "update",
        edition_number: 2,
        id: ADAPTATION_REVISION,
        is_current: true,
        previous_version_id: ADAPTATION,
        recipe_id: ADAPTATION_STABLE,
        relation_kind: "revision",
        title: "Blueberry banana pancakes, updated",
      }),
    ],
    editions_truncated: false,
    recipe_id: ADAPTATION_STABLE,
    selected_version_id: ADAPTATION_REVISION,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("RecipeFamilyNavigator", () => {
  it("distinguishes published editions from adaptations and keeps links exact", () => {
    render(
      <RecipeFamilyNavigator
        currentPath={`/recipes/${SECOND}`}
        history={history()}
        recipe={recipe()}
      />,
    );

    const region = screen.getByRole("region", { name: "Recipe history" });
    expect(within(region).getByText("Published version 2", { selector: ".recipe-family-nav__position" })).toBeVisible();
    expect(within(region).getByText("Published version 1")).toBeVisible();
    expect(within(region).getByText("Author marked this version as a correction.")).toBeVisible();
    expect(within(region).getByRole("link", { name: "Banana oat pancakes, updated" })).toHaveAttribute("href", `/recipes/${SECOND}`);
    expect(within(region).getByRole("link", { name: "Banana oat pancakes, updated" })).toHaveAttribute("aria-current", "page");

    fireEvent.click(within(region).getByRole("button", { name: "Show Banana oat pancakes in recipe history" }));
    expect(within(region).getByRole("button", { name: "Show Blueberry banana pancakes in recipe history" })).toBeVisible();
    expect(within(region).getByText("Adaptation", { selector: ".recipe-family-nav__node-type" })).toBeVisible();
  });

  it("moves focus to the history heading after recentering", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    render(<RecipeFamilyNavigator history={history()} recipe={recipe()} />);

    fireEvent.click(screen.getByRole("button", { name: "Show Banana oat pancakes in recipe history" }));
    expect(screen.getByRole("heading", { name: "Recipe history" })).toHaveFocus();
  });

  it("keeps an adaptation first edition tied to its exact source across revisions", () => {
    render(
      <RecipeFamilyNavigator
        history={adaptedHistory()}
        recipe={adaptedRecipe({
          declared_change_reason: "update",
          edition_number: 2,
          id: ADAPTATION_REVISION,
          parent_version_id: null,
          previous_version_id: ADAPTATION,
          relation_kind: "revision",
          title: "Blueberry banana pancakes, updated",
        })}
      />,
    );

    const region = screen.getByRole("region", { name: "Recipe history" });
    expect(
      within(region).getByText("Published version 2", {
        selector: ".recipe-family-nav__position",
      }),
    ).toBeVisible();
    expect(within(region).getByText("Previous version")).toBeVisible();

    fireEvent.click(
      within(region).getByRole("button", {
        name: "Show Blueberry banana pancakes in recipe history",
      }),
    );

    expect(
      within(region).getByText("Adaptation", {
        selector: ".recipe-family-nav__position",
      }),
    ).toBeVisible();
    expect(within(region).getAllByText("Exact source")).not.toHaveLength(0);
    expect(
      within(region).getByRole("link", { name: "Banana oat pancakes" }),
    ).toHaveAttribute("href", `/recipes/${FIRST}`);
  });

  it("labels a selected adaptation when bounded history omits its entry", () => {
    render(
      <RecipeFamilyNavigator
        history={{
          ...adaptedHistory(),
          current_version_id: ADAPTATION,
          editions: [],
          selected_version_id: ADAPTATION,
        }}
        recipe={adaptedRecipe()}
      />,
    );

    expect(
      screen.getByText("Adaptation", {
        selector: ".recipe-family-nav__position",
      }),
    ).toBeVisible();
    expect(screen.getAllByText("Exact source")).not.toHaveLength(0);
  });

  it("does not disclose a hidden exact source", () => {
    render(
      <RecipeFamilyNavigator
        history={history({ editions: [history().editions[1]] })}
        recipe={recipe()}
      />,
    );

    expect(screen.getByText("Source unavailable")).toBeVisible();
    expect(screen.queryByText("Banana oat pancakes", { exact: true })).toBeNull();
  });

  it("keeps a private adaptation draft separate from published history", () => {
    render(
      <RecipeFamilyNavigator
        draftPreview={{
          authorDisplayName: "Peter",
          id: "private-draft",
          parentVersionId: SECOND,
          title: "My banana pancakes",
        }}
        history={history()}
        recipe={recipe()}
      />,
    );

    const draft = screen.getByLabelText("Selected current draft: My banana pancakes");
    expect(draft).toHaveAttribute("aria-current", "page");
    expect(within(draft).queryByRole("link")).toBeNull();
    expect(draft).toHaveTextContent("Not published");
  });
});
