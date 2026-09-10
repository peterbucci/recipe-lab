// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  RecipeDraftDetail,
  RecipeDraftListItem,
} from "./recipe-draft-api";
import {
  prepareRecipeDraftEditorEntry,
  RecipeDraftEditorEntryError,
} from "./recipe-draft-editor-entry";

const mocks = vi.hoisted(() => ({
  createRecipeDraft: vi.fn(),
  fetchRecipeDraft: vi.fn(),
  findActiveRecipeDraftForSource: vi.fn(),
}));

vi.mock("./recipe-draft-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./recipe-draft-api")>();
  return {
    ...actual,
    createRecipeDraft: mocks.createRecipeDraft,
    fetchRecipeDraft: mocks.fetchRecipeDraft,
    findActiveRecipeDraftForSource: mocks.findActiveRecipeDraftForSource,
  };
});

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";

const detail: RecipeDraftDetail = {
  id: DRAFT_ID,
  source_version_id: SOURCE_ID,
  status: "active",
  revision: 1,
  title: "Recovered tomato soup",
  description: null,
  servings: "4",
  total_time_minutes: 30,
  active_time_minutes: 15,
  difficulty: "easy",
  notes: null,
  categories: [],
  ingredients: [],
  instructions: [],
  created_at: "2026-08-30T12:00:00Z",
  updated_at: "2026-08-30T13:00:00Z",
};

const activeDraft: RecipeDraftListItem = {
  id: DRAFT_ID,
  source_version_id: SOURCE_ID,
  status: "active",
  revision: 1,
  title: detail.title,
  ingredient_count: 0,
  instruction_count: 0,
  created_at: detail.created_at,
  updated_at: detail.updated_at,
};

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recipe draft editor entry recovery", () => {
  it("resumes the created draft when a later catalog failure is retried", async () => {
    let catalogsAvailable = false;
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const path = String(input);
      if (path === "/api/recipe-categories" && !catalogsAvailable) {
        return Response.json(
          { code: "recipe_categories_unavailable" },
          { status: 400 },
        );
      }
      return Response.json({ items: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.findActiveRecipeDraftForSource
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(activeDraft);
    mocks.createRecipeDraft.mockResolvedValue(detail);
    mocks.fetchRecipeDraft.mockResolvedValue(detail);

    await expect(
      prepareRecipeDraftEditorEntry("member-one", SOURCE_ID),
    ).rejects.toBeInstanceOf(RecipeDraftEditorEntryError);
    expect(mocks.createRecipeDraft).toHaveBeenCalledTimes(1);
    expect(mocks.createRecipeDraft).toHaveBeenCalledWith(
      SOURCE_ID,
      expect.any(String),
    );

    catalogsAvailable = true;

    await expect(
      prepareRecipeDraftEditorEntry("member-one", SOURCE_ID),
    ).resolves.toEqual({
      actionTypes: [],
      categories: [],
      detail,
      measurementUnits: [],
    });
    expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledTimes(2);
    expect(mocks.fetchRecipeDraft).toHaveBeenCalledWith(DRAFT_ID);
    expect(mocks.createRecipeDraft).toHaveBeenCalledTimes(1);
  });
});
