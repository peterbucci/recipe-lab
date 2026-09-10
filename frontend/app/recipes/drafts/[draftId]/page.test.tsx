import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import RecipeDraftWorkspacePage from "./page";

const mocks = vi.hoisted(() => ({
  fetchCookingActionTypes: vi.fn(),
  fetchMeasurementUnits: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
  recipeDraftEditor: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

vi.mock("../../../../features/recipes/authoring/shared/cooking-action-api", () => ({
  fetchCookingActionTypes: mocks.fetchCookingActionTypes,
}));

vi.mock("../../../../features/recipes/authoring/shared/measurement-unit-api", () => ({
  fetchMeasurementUnits: mocks.fetchMeasurementUnits,
}));

vi.mock("../../../../features/recipes/authoring/editor/recipe-draft-editor", () => ({
  RecipeDraftEditor: (props: { draftId: string }) => {
    mocks.recipeDraftEditor(props, undefined);
    return (
      <input
        aria-label="Mounted draft resource"
        defaultValue={props.draftId}
      />
    );
  },
}));

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_DRAFT_ID = "66666666-6666-4666-8666-666666666666";
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

  it("remounts the editor when navigation changes the draft resource", async () => {
    mocks.fetchMeasurementUnits.mockResolvedValue([MASS_UNIT]);
    mocks.fetchCookingActionTypes.mockResolvedValue([ACTION_TYPE]);

    const view = render(
      await RecipeDraftWorkspacePage({
        params: Promise.resolve({ draftId: DRAFT_ID }),
      }),
    );
    const mountedDraft = screen.getByLabelText("Mounted draft resource");
    fireEvent.change(mountedDraft, { target: { value: "Unsaved work for A" } });

    view.rerender(
      await RecipeDraftWorkspacePage({
        params: Promise.resolve({ draftId: OTHER_DRAFT_ID }),
      }),
    );

    expect(screen.getByLabelText("Mounted draft resource")).toHaveValue(
      OTHER_DRAFT_ID,
    );
  });
});
