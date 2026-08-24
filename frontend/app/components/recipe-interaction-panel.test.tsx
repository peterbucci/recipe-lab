import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeViewerState } from "../../lib/interaction-api";
import { RecipeInteractionPanel } from "./recipe-interaction-panel";

const mocks = vi.hoisted(() => ({
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
  setRecipeRating: mocks.setRecipeRating,
  setRecipeSaved: mocks.setRecipeSaved,
}));

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: mocks.createIdempotencyKey,
}));

function viewerState(overrides: Partial<RecipeViewerState> = {}): RecipeViewerState {
  return {
    recipe_version_id: "29454eba-3a4e-5380-b48c-c49dc3697b17",
    saved: false,
    rating: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  let keyIndex = 0;
  const keys = [FIRST_KEY, SECOND_KEY, THIRD_KEY];
  mocks.createIdempotencyKey.mockImplementation(() => keys[keyIndex++] ?? THIRD_KEY);
});

describe("RecipeInteractionPanel", () => {
  it("describes account-private controls with member-neutral copy", () => {
    render(
      <RecipeInteractionPanel initialViewerState={viewerState({ saved: true, rating: 4 })} />,
    );

    expect(
      screen.getByRole("region", {
        name: /save and rate this recipe/i,
      }),
    ).toBeInTheDocument();
    const context = screen.getByText(/saves and ratings are specific to your account/i);
    expect(context).toHaveClass("visually-hidden");
    const removeSaveButton = screen.getByRole("button", { name: /remove saved recipe/i });
    expect(removeSaveButton).toHaveAttribute("aria-pressed", "true");
    expect(removeSaveButton).toHaveAccessibleDescription(/specific to your account/i);
    expect(removeSaveButton).toHaveTextContent("Remove saved recipe");
    expect(screen.getByRole("radio", { name: /4 stars/i })).toBeChecked();
    expect(screen.getByText(/your current rating is 4 out of 5/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update rating/i })).toBeDisabled();
  });

  it("saves and unsaves from the canonical API response", async () => {
    const initialState = viewerState();
    mocks.setRecipeSaved
      .mockResolvedValueOnce({ ...initialState, saved: true })
      .mockResolvedValueOnce(initialState);
    render(<RecipeInteractionPanel initialViewerState={initialState} />);

    fireEvent.click(screen.getByRole("button", { name: /^save recipe$/i }));

    expect(mocks.setRecipeSaved).toHaveBeenCalledWith(
      initialState.recipe_version_id,
      true,
      FIRST_KEY,
    );
    expect(await screen.findByText(/saved to your account/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove saved recipe/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(screen.getByRole("button", { name: /remove saved recipe/i }));

    expect(mocks.setRecipeSaved).toHaveBeenLastCalledWith(
      initialState.recipe_version_id,
      false,
      SECOND_KEY,
    );
    expect(await screen.findByText(/removed from your saved recipes/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^save recipe$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("prevents duplicate save requests while a write is pending", async () => {
    const initialState = viewerState();
    let resolveSave: (state: RecipeViewerState) => void = () => undefined;
    mocks.setRecipeSaved.mockReturnValue(
      new Promise<RecipeViewerState>((resolve) => {
        resolveSave = resolve;
      }),
    );
    render(<RecipeInteractionPanel initialViewerState={initialState} />);

    const saveButton = screen.getByRole("button", { name: /^save recipe$/i });
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(mocks.setRecipeSaved).toHaveBeenCalledOnce();
    expect(saveButton).toBeDisabled();
    expect(saveButton).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      resolveSave({ ...initialState, saved: true });
    });

    expect(screen.getByRole("button", { name: /remove saved recipe/i })).toBeEnabled();
  });

  it("rates, updates the committed state, and refreshes the server aggregate", async () => {
    const initialState = viewerState({ rating: 2 });
    mocks.setRecipeRating.mockResolvedValue({ ...initialState, rating: 4 });
    render(<RecipeInteractionPanel initialViewerState={initialState} />);

    fireEvent.click(screen.getByRole("radio", { name: /4 stars/i }));
    const updateButton = screen.getByRole("button", { name: /update rating/i });
    expect(updateButton).toBeEnabled();
    fireEvent.click(updateButton);

    expect(mocks.setRecipeRating).toHaveBeenCalledWith(
      initialState.recipe_version_id,
      4,
      FIRST_KEY,
    );
    expect(await screen.findByText(/your rating is now 4 out of 5/i)).toBeInTheDocument();
    expect(screen.getByText(/your current rating is 4 out of 5/i)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /4 stars/i })).toBeChecked();
    expect(screen.getByRole("button", { name: /update rating/i })).toBeDisabled();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it("announces failures and preserves the last confirmed state", async () => {
    const initialState = viewerState();
    mocks.setRecipeSaved.mockRejectedValue(new Error("network unavailable"));
    mocks.setRecipeRating.mockRejectedValue(new Error("network unavailable"));
    render(<RecipeInteractionPanel initialViewerState={initialState} />);

    fireEvent.click(screen.getByRole("button", { name: /^save recipe$/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/previous state is unchanged/i);
    expect(screen.getByRole("button", { name: /^save recipe$/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    fireEvent.click(screen.getByRole("radio", { name: /3 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: /rate recipe/i }));

    await waitFor(() => {
      expect(screen.getByText(/previous rating is unchanged/i)).toBeInTheDocument();
    });
    expect(screen.getAllByRole("alert")).toHaveLength(2);
    expect(screen.getByText(/previous state is unchanged/i)).toBeInTheDocument();
    expect(screen.getByText(/you haven’t rated this recipe yet/i)).toBeInTheDocument();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("reuses a save key after failure and replaces it when the desired state changes", async () => {
    const initialState = viewerState();
    mocks.setRecipeSaved
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ ...initialState, saved: true })
      .mockResolvedValueOnce(initialState);
    render(<RecipeInteractionPanel initialViewerState={initialState} />);

    fireEvent.click(screen.getByRole("button", { name: /^save recipe$/i }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /^save recipe$/i }));
    await screen.findByText(/saved to your account/i);
    fireEvent.click(screen.getByRole("button", { name: /remove saved recipe/i }));
    await screen.findByText(/removed from your saved recipes/i);

    expect(mocks.setRecipeSaved.mock.calls).toEqual([
      [initialState.recipe_version_id, true, FIRST_KEY],
      [initialState.recipe_version_id, true, FIRST_KEY],
      [initialState.recipe_version_id, false, SECOND_KEY],
    ]);
    expect(mocks.createIdempotencyKey).toHaveBeenCalledTimes(2);
  });

  it("reuses a rating key after failure and replaces it when the rating changes", async () => {
    const initialState = viewerState();
    mocks.setRecipeRating
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce({ ...initialState, rating: 3 })
      .mockResolvedValueOnce({ ...initialState, rating: 4 });
    render(<RecipeInteractionPanel initialViewerState={initialState} />);

    fireEvent.click(screen.getByRole("radio", { name: /3 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: /rate recipe/i }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /rate recipe/i }));
    await screen.findByText(/rating is now 3 out of 5/i);

    fireEvent.click(screen.getByRole("radio", { name: /4 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: /update rating/i }));
    await screen.findByText(/rating is now 4 out of 5/i);

    expect(mocks.setRecipeRating.mock.calls).toEqual([
      [initialState.recipe_version_id, 3, FIRST_KEY],
      [initialState.recipe_version_id, 3, FIRST_KEY],
      [initialState.recipe_version_id, 4, SECOND_KEY],
    ]);
    expect(mocks.createIdempotencyKey).toHaveBeenCalledTimes(2);
  });
});
