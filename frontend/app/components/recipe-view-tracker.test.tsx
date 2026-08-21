import { StrictMode } from "react";
import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecipeViewTracker } from "./recipe-view-tracker";

const mocks = vi.hoisted(() => ({
  createIdempotencyKey: vi.fn(),
  recordRecipeView: vi.fn(),
}));

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: mocks.createIdempotencyKey,
}));

vi.mock("../../lib/interaction-api", () => ({
  recordRecipeView: mocks.recordRecipeView,
}));

const FIRST_RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_RECIPE_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SECOND_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createIdempotencyKey
    .mockReturnValueOnce(FIRST_KEY)
    .mockReturnValueOnce(SECOND_KEY);
  mocks.recordRecipeView.mockRejectedValue(new Error("collection unavailable"));
});

describe("RecipeViewTracker", () => {
  it("uses one stable key per mounted recipe and ignores collection failures", async () => {
    const { rerender } = render(
      <StrictMode>
        <RecipeViewTracker recipeVersionId={FIRST_RECIPE_ID} />
      </StrictMode>,
    );

    await waitFor(() => expect(mocks.recordRecipeView).toHaveBeenCalled());
    expect(mocks.createIdempotencyKey).toHaveBeenCalledOnce();
    expect(
      mocks.recordRecipeView.mock.calls.every(
        (call) => call[0] === FIRST_RECIPE_ID && call[1] === FIRST_KEY,
      ),
    ).toBe(true);

    rerender(
      <StrictMode>
        <RecipeViewTracker recipeVersionId={SECOND_RECIPE_ID} />
      </StrictMode>,
    );

    await waitFor(() => {
      expect(mocks.recordRecipeView).toHaveBeenCalledWith(SECOND_RECIPE_ID, SECOND_KEY);
    });
    expect(mocks.createIdempotencyKey).toHaveBeenCalledTimes(2);
  });
});
