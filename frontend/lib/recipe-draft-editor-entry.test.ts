import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CatalogActionType } from "./cooking-action-api";
import type { CatalogUnit } from "./measurement-unit-api";
import type { RecipeDraftDetail } from "./recipe-draft-api";
import {
  prepareRecipeDraftEditorEntry,
  RecipeDraftEditorEntryError,
} from "./recipe-draft-editor-entry";

const mocks = vi.hoisted(() => ({
  startOrResumeRecipeDraftDetail: vi.fn(),
}));

vi.mock("./recipe-draft-entry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./recipe-draft-entry")>();
  return {
    ...actual,
    startOrResumeRecipeDraftDetail:
      mocks.startOrResumeRecipeDraftDetail,
  };
});

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";

const gram: CatalogUnit = {
  id: "33333333-3333-4333-8333-333333333333",
  key: "gram",
  dimension: "mass",
  canonical_label: "gram",
  plural_label: "grams",
  symbol: "g",
  display_style: "symbol",
  aliases: ["gram", "grams"],
  active: true,
  provenance: "Reviewed unit seed data.",
};

const second: CatalogUnit = {
  id: "44444444-4444-4444-8444-444444444444",
  key: "second",
  dimension: "time",
  canonical_label: "second",
  plural_label: "seconds",
  symbol: "s",
  display_style: "symbol",
  aliases: ["second", "seconds"],
  active: true,
  provenance: "Reviewed unit seed data.",
};

const celsius: CatalogUnit = {
  id: "55555555-5555-4555-8555-555555555555",
  key: "degree-celsius",
  dimension: "temperature",
  canonical_label: "degree Celsius",
  plural_label: "degrees Celsius",
  symbol: "\u00b0C",
  display_style: "symbol",
  aliases: ["Celsius"],
  active: true,
  provenance: "Reviewed unit seed data.",
};

const mix: CatalogActionType = {
  id: "66666666-6666-4666-8666-666666666666",
  key: "mix",
  canonical_verb: "mix",
  active: true,
  provenance: "Reviewed action seed data.",
};

const breakfastCategory = {
  id: "77777777-7777-4777-8777-777777777777",
  name: "Breakfast",
  slug: "breakfast",
};

const detail: RecipeDraftDetail = {
  id: DRAFT_ID,
  source_version_id: SOURCE_ID,
  status: "active",
  revision: 2,
  title: "My tomato soup",
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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recipe draft editor entry", () => {
  it("awaits the full draft and every catalog before returning deduplicated controls", async () => {
    const draft = deferred<RecipeDraftDetail>();
    const ingredientUnits = deferred<unknown>();
    const durationUnits = deferred<unknown>();
    const temperatureUnits = deferred<unknown>();
    const actionTypes = deferred<unknown>();
    const categories = deferred<unknown>();
    const catalogPayloads = new Map<string, Promise<unknown>>([
      [
        "/api/measurement-units?semantic=ingredient_amount",
        ingredientUnits.promise,
      ],
      [
        "/api/measurement-units?semantic=action_duration",
        durationUnits.promise,
      ],
      [
        "/api/measurement-units?semantic=temperature",
        temperatureUnits.promise,
      ],
      ["/api/cooking-action-types?limit=100", actionTypes.promise],
      ["/api/recipe-categories", categories.promise],
    ]);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(async (input) => {
      const payload = catalogPayloads.get(String(input));
      if (payload === undefined) throw new Error(`Unexpected URL: ${input}`);
      return {
        ok: true,
        json: () => payload,
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    mocks.startOrResumeRecipeDraftDetail.mockReturnValue(draft.promise);

    let settled = false;
    const entryPromise = prepareRecipeDraftEditorEntry(
      "member-one",
      SOURCE_ID,
    );
    void entryPromise.finally(() => {
      settled = true;
    });

    await flushMicrotasks();

    expect(mocks.startOrResumeRecipeDraftDetail).toHaveBeenCalledWith(
      "member-one",
      SOURCE_ID,
    );
    expect(fetchMock.mock.calls).toEqual([
      [
        "/api/measurement-units?semantic=ingredient_amount",
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      ],
      [
        "/api/measurement-units?semantic=action_duration",
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      ],
      [
        "/api/measurement-units?semantic=temperature",
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      ],
      [
        "/api/cooking-action-types?limit=100",
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      ],
      [
        "/api/recipe-categories",
        {
          cache: "no-store",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        },
      ],
    ]);

    ingredientUnits.resolve({ items: [gram] });
    durationUnits.resolve({ items: [second, gram] });
    temperatureUnits.resolve({ items: [celsius, second] });
    actionTypes.resolve({ items: [mix] });
    categories.resolve({ items: [breakfastCategory] });
    await flushMicrotasks();
    expect(settled).toBe(false);

    draft.resolve(detail);

    await expect(entryPromise).resolves.toEqual({
      actionTypes: [mix],
      categories: [breakfastCategory],
      detail,
      measurementUnits: [gram, second, celsius],
    });
  });

  it("does not finish while a catalog response is still pending", async () => {
    const temperatureUnits = deferred<unknown>();
    mocks.startOrResumeRecipeDraftDetail.mockResolvedValue(detail);
    const fetchMock = vi.fn<typeof fetch>();
    fetchMock.mockImplementation(async (input) => {
      const path = String(input);
      if (path.includes("semantic=temperature")) {
        return {
          ok: true,
          json: () => temperatureUnits.promise,
        } as Response;
      }
      if (path.includes("cooking-action-types")) {
        return Response.json({ items: [mix] });
      }
      if (path.includes("recipe-categories")) {
        return Response.json({ items: [breakfastCategory] });
      }
      return Response.json({ items: [gram] });
    });
    vi.stubGlobal("fetch", fetchMock);

    let settled = false;
    const entryPromise = prepareRecipeDraftEditorEntry(
      "member-one",
      SOURCE_ID,
    );
    void entryPromise.finally(() => {
      settled = true;
    });

    await flushMicrotasks();
    expect(settled).toBe(false);

    temperatureUnits.resolve({ items: [celsius] });

    await expect(entryPromise).resolves.toMatchObject({
      actionTypes: [mix],
      categories: [breakfastCategory],
      detail,
      measurementUnits: [gram, celsius],
    });
  });

  it("replaces private upstream failure details with stable editor-entry copy", async () => {
    mocks.startOrResumeRecipeDraftDetail.mockResolvedValue(detail);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response("private catalog gateway detail", { status: 503 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const error = await prepareRecipeDraftEditorEntry(
      "member-one",
      SOURCE_ID,
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RecipeDraftEditorEntryError);
    expect(error).toMatchObject({
      message:
        "Recipe Lab could not prepare the editable version. This recipe is unchanged; try again.",
      name: "RecipeDraftEditorEntryError",
    });
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(
      "private catalog gateway detail",
    );
  });
});
