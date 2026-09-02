import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RecipeDraftWorkspacePage from "./page";

const mocks = vi.hoisted(() => ({
  fetchCookingActionTypes: vi.fn(),
  fetchMeasurementUnits: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
  recipeDraftEditor: vi.fn(() => null),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

vi.mock("../../../../lib/cooking-action-api", () => ({
  fetchCookingActionTypes: mocks.fetchCookingActionTypes,
}));

vi.mock("../../../../lib/measurement-unit-api", () => ({
  fetchMeasurementUnits: mocks.fetchMeasurementUnits,
}));

vi.mock("../../../components/recipe-draft-editor", () => ({
  RecipeDraftEditor: mocks.recipeDraftEditor,
}));

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const MASS_UNIT = {
  id: "22222222-2222-4222-8222-222222222222",
  key: "gram",
};
const TIME_UNIT = {
  id: "33333333-3333-4333-8333-333333333333",
  key: "minute",
};
const TEMPERATURE_UNIT = {
  id: "44444444-4444-4444-8444-444444444444",
  key: "celsius",
};
const ACTION_TYPE = {
  id: "55555555-5555-4555-8555-555555555555",
  key: "mix",
};

describe("RecipeDraftWorkspacePage", () => {
  beforeEach(() => {
    mocks.fetchCookingActionTypes.mockReset();
    mocks.fetchMeasurementUnits.mockReset();
    mocks.notFound.mockClear();
    mocks.recipeDraftEditor.mockClear();
  });

  it("loads each authoring catalog and renders the stable private workspace", async () => {
    mocks.fetchMeasurementUnits
      .mockResolvedValueOnce([MASS_UNIT])
      .mockResolvedValueOnce([TIME_UNIT])
      .mockResolvedValueOnce([TIME_UNIT, TEMPERATURE_UNIT]);
    mocks.fetchCookingActionTypes.mockResolvedValueOnce([ACTION_TYPE]);

    render(
      await RecipeDraftWorkspacePage({
        params: Promise.resolve({ draftId: DRAFT_ID }),
      }),
    );

    expect(mocks.fetchMeasurementUnits.mock.calls).toEqual([
      ["ingredient_amount"],
      ["action_duration"],
      ["temperature"],
    ]);
    expect(mocks.fetchCookingActionTypes).toHaveBeenCalledOnce();
    expect(mocks.recipeDraftEditor).toHaveBeenCalledWith(
      {
        actionTypes: [ACTION_TYPE],
        draftId: DRAFT_ID,
        measurementUnits: [MASS_UNIT, TIME_UNIT, TEMPERATURE_UNIT],
        presentation: "recipe",
      },
      undefined,
    );
  });

  it("rejects malformed draft identifiers before loading private catalogs", async () => {
    await expect(
      RecipeDraftWorkspacePage({
        params: Promise.resolve({ draftId: "not-a-draft-id" }),
      }),
    ).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.fetchMeasurementUnits).not.toHaveBeenCalled();
    expect(mocks.fetchCookingActionTypes).not.toHaveBeenCalled();
  });
});
