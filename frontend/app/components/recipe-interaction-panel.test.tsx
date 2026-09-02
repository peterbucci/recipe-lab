import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import Link from "next/link";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeViewerState } from "../../lib/interaction-api";
import { RecipeInteractionPanel } from "./recipe-interaction-panel";

const mocks = vi.hoisted(() => ({
  clearRecipeRating: vi.fn(),
  createIdempotencyKey: vi.fn(),
  refresh: vi.fn(),
  setRecipeRating: vi.fn(),
  setRecipeSaved: vi.fn(),
}));

const FIRST_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SECOND_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const THIRD_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));

vi.mock("../../lib/interaction-api", () => ({
  clearRecipeRating: mocks.clearRecipeRating,
  setRecipeRating: mocks.setRecipeRating,
  setRecipeSaved: mocks.setRecipeSaved,
}));

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: mocks.createIdempotencyKey,
}));

function viewerState(
  overrides: Partial<RecipeViewerState> = {},
): RecipeViewerState {
  return {
    recipe_version_id: "29454eba-3a4e-5380-b48c-c49dc3697b17",
    saved: false,
    rating: null,
    ...overrides,
  };
}

function renderPanel(
  state: RecipeViewerState,
  onSavedChange?: (saved: boolean, previouslySaved: boolean) => void,
) {
  return render(
    <RecipeInteractionPanel
      initialViewerState={state}
      onSavedChange={onSavedChange}
      primaryAction={
        <Link href="/recipes/example/fork">Make your own version</Link>
      }
    />,
  );
}

function openRating() {
  fireEvent.click(
    screen.getByRole("button", { name: /rate recipe|change rating/i }),
  );
  return screen.getByRole("dialog");
}

beforeEach(() => {
  vi.clearAllMocks();
  let keyIndex = 0;
  const keys = [FIRST_KEY, SECOND_KEY, THIRD_KEY];
  mocks.createIdempotencyKey.mockImplementation(
    () => keys[keyIndex++] ?? THIRD_KEY,
  );
});

describe("RecipeInteractionPanel", () => {
  it("renders the compact actions and opens the existing rating", () => {
    renderPanel(viewerState({ saved: true, rating: 4 }));

    const region = screen.getByRole("region", {
      name: /save and rate this recipe/i,
    });
    expect(region).toBeInTheDocument();
    expect(
      screen.getByText(/saves and ratings are specific to your account/i),
    ).toHaveClass("visually-hidden");
    const saveButton = screen.getByRole("button", {
      name: /remove saved recipe/i,
    });
    expect(saveButton).toHaveTextContent("Save");
    expect(saveButton).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("link", { name: /make your own version/i }),
    ).toBeVisible();

    openRating();
    expect(screen.getByRole("heading", { name: "Your rating" })).toBeVisible();
    expect(
      screen.getByRole("button", { name: /4 stars — really good/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remove rating" })).toBeVisible();
  });

  it("saves and unsaves from the canonical API response", async () => {
    const initialState = viewerState();
    const onSavedChange = vi.fn();
    mocks.setRecipeSaved
      .mockResolvedValueOnce({ ...initialState, saved: true })
      .mockResolvedValueOnce(initialState);
    renderPanel(initialState, onSavedChange);

    const saveButton = screen.getByRole("button", { name: "Save recipe" });
    expect(saveButton.querySelector('svg[data-icon="heart"]')).not.toBeNull();
    fireEvent.click(saveButton);
    expect(mocks.setRecipeSaved).toHaveBeenCalledWith(
      initialState.recipe_version_id,
      true,
      FIRST_KEY,
    );
    expect(await screen.findByText("Saved to your account.")).toBeVisible();
    expect(onSavedChange).toHaveBeenLastCalledWith(true, false);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove saved recipe" }),
    );
    expect(mocks.setRecipeSaved).toHaveBeenLastCalledWith(
      initialState.recipe_version_id,
      false,
      SECOND_KEY,
    );
    expect(
      await screen.findByText(/removed from your saved recipes/i),
    ).toBeVisible();
    expect(onSavedChange).toHaveBeenLastCalledWith(false, true);
    const region = screen.getByRole("region", {
      name: /save and rate this recipe/i,
    });
    const actionStrip = region.querySelector(".recipe-action-strip");
    const feedback = region.querySelector(".recipe-interaction-feedback");
    expect(actionStrip?.nextElementSibling).toBe(feedback);
  });

  it("prevents duplicate save requests while a write is pending", async () => {
    const initialState = viewerState();
    let resolveSave: (state: RecipeViewerState) => void = () => undefined;
    mocks.setRecipeSaved.mockReturnValue(
      new Promise<RecipeViewerState>((resolve) => {
        resolveSave = resolve;
      }),
    );
    renderPanel(initialState);

    const saveButton = screen.getByRole("button", { name: "Save recipe" });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    expect(mocks.setRecipeSaved).toHaveBeenCalledOnce();
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute("aria-busy", "true");

    await act(async () => resolveSave({ ...initialState, saved: true }));
    expect(
      screen.getByRole("button", { name: "Remove saved recipe" }),
    ).toBeEnabled();
  });

  it("saves a selected star immediately and refreshes the aggregate", async () => {
    const initialState = viewerState({ rating: 2 });
    mocks.setRecipeRating.mockResolvedValue({ ...initialState, rating: 4 });
    renderPanel(initialState);

    openRating();
    fireEvent.mouseEnter(
      screen.getByRole("button", { name: /4 stars — really good/i }),
    );
    expect(screen.getByText("Really good")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: /4 stars — really good/i }),
    );

    expect(mocks.setRecipeRating).toHaveBeenCalledWith(
      initialState.recipe_version_id,
      4,
      FIRST_KEY,
    );
    expect(await screen.findByText("✓ Rated 4 stars")).toBeVisible();
    expect(mocks.refresh).toHaveBeenCalledOnce();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), {
      timeout: 1_200,
    });
    expect(
      screen.getByRole("button", { name: /currently 4 stars/i }),
    ).toHaveTextContent("4");
  });

  it("shows a stable shared pending treatment on the selected rating", async () => {
    const initialState = viewerState({ rating: 2 });
    let resolveRating!: (state: RecipeViewerState) => void;
    mocks.setRecipeRating.mockReturnValue(
      new Promise<RecipeViewerState>((resolve) => {
        resolveRating = resolve;
      }),
    );
    renderPanel(initialState);

    openRating();
    fireEvent.click(
      screen.getByRole("button", { name: /4 stars — really good/i }),
    );

    const pendingRating = screen.getByRole("button", {
      name: "Saving 4 stars…",
    });
    expect(pendingRating).toBeDisabled();
    expect(pendingRating).toHaveAttribute("aria-busy", "true");
    expect(
      screen.getByRole("button", { name: /3 stars — good/i }),
    ).toBeDisabled();

    await act(async () => {
      resolveRating({ ...initialState, rating: 4 });
    });
    expect(await screen.findByText("✓ Rated 4 stars")).toBeVisible();
  });

  it("keeps the popover open and the confirmed rating intact after failure", async () => {
    const initialState = viewerState({ rating: 2 });
    mocks.setRecipeRating.mockRejectedValue(new Error("network unavailable"));
    renderPanel(initialState);

    openRating();
    fireEvent.click(screen.getByRole("button", { name: /3 stars — good/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /previous rating is unchanged/i,
    );
    expect(screen.getByRole("dialog")).toBeVisible();
    expect(
      screen.getByRole("button", { name: /2 stars — okay/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("reuses an idempotency key after a failed rating and replaces it for a new rating", async () => {
    const initialState = viewerState();
    mocks.setRecipeRating
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ ...initialState, rating: 3 })
      .mockResolvedValueOnce({ ...initialState, rating: 4 });
    renderPanel(initialState);

    openRating();
    fireEvent.click(screen.getByRole("button", { name: /3 stars — good/i }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /3 stars — good/i }));
    await screen.findByText("✓ Rated 3 stars");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), {
      timeout: 1_200,
    });

    openRating();
    fireEvent.click(
      screen.getByRole("button", { name: /4 stars — really good/i }),
    );
    await screen.findByText("✓ Rated 4 stars");

    expect(mocks.setRecipeRating.mock.calls).toEqual([
      [initialState.recipe_version_id, 3, FIRST_KEY],
      [initialState.recipe_version_id, 3, FIRST_KEY],
      [initialState.recipe_version_id, 4, SECOND_KEY],
    ]);
    expect(mocks.createIdempotencyKey).toHaveBeenCalledTimes(2);
  });

  it("removes an existing rating without a confirmation step", async () => {
    const initialState = viewerState({ rating: 5 });
    mocks.clearRecipeRating.mockResolvedValue({
      ...initialState,
      rating: null,
    });
    renderPanel(initialState);

    openRating();
    fireEvent.click(screen.getByRole("button", { name: "Remove rating" }));

    expect(mocks.clearRecipeRating).toHaveBeenCalledWith(
      initialState.recipe_version_id,
      FIRST_KEY,
    );
    expect(await screen.findByText("✓ Rating removed")).toBeVisible();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), {
      timeout: 1_200,
    });
    expect(
      screen.getByRole("button", { name: "Rate recipe" }),
    ).toHaveTextContent("Rate");
  });

  it("reuses a save key after failure and replaces it when the desired state changes", async () => {
    const initialState = viewerState();
    mocks.setRecipeSaved
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ ...initialState, saved: true })
      .mockResolvedValueOnce(initialState);
    renderPanel(initialState);

    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    await screen.findByText("Saved to your account.");
    fireEvent.click(
      screen.getByRole("button", { name: "Remove saved recipe" }),
    );
    await screen.findByText(/removed from your saved recipes/i);

    expect(mocks.setRecipeSaved.mock.calls).toEqual([
      [initialState.recipe_version_id, true, FIRST_KEY],
      [initialState.recipe_version_id, true, FIRST_KEY],
      [initialState.recipe_version_id, false, SECOND_KEY],
    ]);
    expect(mocks.createIdempotencyKey).toHaveBeenCalledTimes(2);
  });
});
