import { describe, expect, it } from "vitest";

import type { MyRecipeLibraryPage } from "./recipe-library-api";
import {
  createMyRecipeLibraryState,
  currentMyRecipeLibraryState,
  myRecipeLibraryReducer,
} from "./my-recipe-library-state";

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const FIRST_KEY = "drafts:1";

const draftPage: MyRecipeLibraryPage = {
  items: [
    {
      description: "A private work in progress.",
      draft: {
        created_at: "2026-08-20T12:00:00Z",
        id: DRAFT_ID,
        ingredient_count: 2,
        instruction_count: 1,
        revision: 3,
        source_version_id: null,
        status: "active",
        title: "Soup in progress",
        updated_at: "2026-08-20T13:00:00Z",
      },
      kind: "draft",
      source_recipe_title: null,
    },
  ],
  page: 1,
  page_size: 12,
  total: 1,
  total_pages: 1,
};

describe("My Recipes library state", () => {
  it("keeps loading, errors, and retry success in one request state", () => {
    let state = createMyRecipeLibraryState(FIRST_KEY);
    expect(currentMyRecipeLibraryState(state, FIRST_KEY)).toMatchObject({
      error: "",
      loading: true,
      page: null,
    });

    state = myRecipeLibraryReducer(state, {
      type: "load_failed",
      key: FIRST_KEY,
      message: "Could not load drafts.",
    });
    expect(currentMyRecipeLibraryState(state, FIRST_KEY)).toMatchObject({
      error: "Could not load drafts.",
      loading: false,
      page: null,
    });

    state = myRecipeLibraryReducer(state, {
      type: "load_started",
      key: FIRST_KEY,
    });
    state = myRecipeLibraryReducer(state, {
      type: "load_succeeded",
      key: FIRST_KEY,
      page: draftPage,
    });
    expect(currentMyRecipeLibraryState(state, FIRST_KEY)).toMatchObject({
      error: "",
      loading: false,
      page: draftPage,
    });
  });

  it("clears stale notices and confirmation when the location changes", () => {
    let state = createMyRecipeLibraryState(FIRST_KEY);
    state = myRecipeLibraryReducer(state, {
      type: "confirmation_toggled",
      key: FIRST_KEY,
      draftId: DRAFT_ID,
    });
    state = myRecipeLibraryReducer(state, {
      type: "discard_started",
      key: FIRST_KEY,
      draftId: DRAFT_ID,
    });
    state = myRecipeLibraryReducer(state, {
      type: "discard_failed",
      key: FIRST_KEY,
      message: "The draft is still intact.",
    });
    state = myRecipeLibraryReducer(state, {
      type: "status_set",
      focus: false,
      key: FIRST_KEY,
      message: "Previous status.",
    });

    state = myRecipeLibraryReducer(state, {
      type: "location_changed",
      key: "published:1",
    });

    expect(currentMyRecipeLibraryState(state, "published:1")).toMatchObject({
      confirmingId: null,
      operationError: "",
      status: "",
    });
  });

  it("removes only the matching item and announces the destination page", () => {
    let state = createMyRecipeLibraryState(FIRST_KEY);
    state = myRecipeLibraryReducer(state, {
      type: "load_succeeded",
      key: FIRST_KEY,
      page: draftPage,
    });
    state = myRecipeLibraryReducer(state, {
      type: "confirmation_toggled",
      key: FIRST_KEY,
      draftId: DRAFT_ID,
    });
    state = myRecipeLibraryReducer(state, {
      type: "item_removed",
      itemKey: `draft:${DRAFT_ID}`,
      message: "Soup in progress was permanently discarded.",
      originKey: FIRST_KEY,
      targetKey: FIRST_KEY,
    });

    expect(currentMyRecipeLibraryState(state, FIRST_KEY)).toMatchObject({
      confirmingId: null,
      focusStatus: true,
      loading: false,
      status: "Soup in progress was permanently discarded.",
    });
    expect(currentMyRecipeLibraryState(state, FIRST_KEY).page).toMatchObject({
      items: [],
      total: 0,
      total_pages: 0,
    });
  });

  it("does not let an obsolete discard completion clear a newer one", () => {
    let state = createMyRecipeLibraryState(FIRST_KEY);
    state = myRecipeLibraryReducer(state, {
      type: "discard_started",
      key: FIRST_KEY,
      draftId: "older-draft",
    });
    state = myRecipeLibraryReducer(state, {
      type: "discard_started",
      key: FIRST_KEY,
      draftId: "newer-draft",
    });
    state = myRecipeLibraryReducer(state, {
      type: "discard_finished",
      draftId: "older-draft",
    });

    expect(currentMyRecipeLibraryState(state, FIRST_KEY).discardingId).toBe(
      "newer-draft",
    );
  });
});
