import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../lib/auth-api";
import { AuthSessionProvider } from "./auth-session-provider";
import {
  RecipeCardEngagement,
  RecipeCardViewerStateProvider,
} from "./recipe-card-engagement";

const mocks = vi.hoisted(() => ({
  fetchRecipeViewerState: vi.fn(),
  fetchRecipeViewerStates: vi.fn(),
  setRecipeSaved: vi.fn(),
}));

vi.mock("../../lib/interaction-api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/interaction-api")>()),
  fetchRecipeViewerState: mocks.fetchRecipeViewerState,
  fetchRecipeViewerStates: mocks.fetchRecipeViewerStates,
  setRecipeSaved: mocks.setRecipeSaved,
}));

const recipeVersionId = "recipe-one";
const member: AuthSession = {
  status: "authenticated",
  user: { id: "member-one", display_name: "Member One", handle: "member-one" },
};

function renderEngagement(session: AuthSession) {
  render(
    <AuthSessionProvider initialSession={session}>
      <RecipeCardEngagement
        averageRating={4.5}
        lineageLabel="Original"
        ratingCount={2}
        recipeVersionId={recipeVersionId}
        saveCount={12}
        servings="8 servings"
        title="Carrot Walnut Snack Cake"
      >
        <div>Card content</div>
      </RecipeCardEngagement>
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  mocks.fetchRecipeViewerState.mockReset();
  mocks.fetchRecipeViewerStates.mockReset();
  mocks.setRecipeSaved.mockReset();
});

describe("RecipeCardEngagement", () => {
  it("shows honest public totals and gates the heart for a signed-out visitor", () => {
    renderEngagement({ status: "anonymous" });

    expect(screen.getByLabelText("4.5 out of 5 from 2 ratings")).toBeVisible();
    expect(screen.getByText("12 saves")).toBeVisible();
    expect(screen.getByText("8 servings")).toBeVisible();
    const saveLink = screen.getByRole("link", {
      name: "Sign in to save Carrot Walnut Snack Cake",
    });
    expect(saveLink).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Frecipes%2Frecipe-one",
    );
    expect(screen.getByText("Original").parentElement).toContainElement(
      saveLink,
    );
    expect(
      screen.queryByText(/cook time|minutes?|hours?/i),
    ).not.toBeInTheDocument();
    expect(mocks.fetchRecipeViewerState).not.toHaveBeenCalled();
  });

  it("routes an incomplete account through setup without exposing a false saved state", () => {
    renderEngagement({
      status: "onboarding_required",
      user: {
        id: "pending-member",
        display_name: "Pending Member",
        handle: null,
      },
    });

    expect(
      screen.getByRole("link", {
        name: "Finish account setup to save Carrot Walnut Snack Cake",
      }),
    ).toHaveAttribute("href", "/onboarding?return_to=%2Frecipes%2Frecipe-one");
    expect(
      screen.queryByRole("button", { name: /^save /i }),
    ).not.toBeInTheDocument();
  });

  it("loads the member state and saves from the heart using the canonical response", async () => {
    mocks.fetchRecipeViewerState.mockResolvedValue({
      recipe_version_id: recipeVersionId,
      saved: false,
      rating: null,
    });
    mocks.setRecipeSaved.mockResolvedValue({
      recipe_version_id: recipeVersionId,
      saved: true,
      rating: null,
    });
    renderEngagement(member);

    const saveButton = await screen.findByRole("button", {
      name: "Save Carrot Walnut Snack Cake",
    });
    expect(saveButton).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(
        screen.getByRole("button", {
          name: "Remove saved Carrot Walnut Snack Cake",
        }),
      ).toHaveAttribute("aria-pressed", "true");
    });
    expect(screen.getByText("13 saves")).toBeVisible();
    expect(mocks.setRecipeSaved).toHaveBeenCalledWith(
      recipeVersionId,
      true,
      expect.any(String),
    );
  });

  it("loads all card hearts through one shared viewer-state request", async () => {
    mocks.fetchRecipeViewerStates.mockResolvedValue([
      {
        recipe_version_id: recipeVersionId,
        saved: true,
        rating: null,
      },
      {
        recipe_version_id: "recipe-two",
        saved: false,
        rating: 4,
      },
    ]);

    render(
      <AuthSessionProvider initialSession={member}>
        <RecipeCardViewerStateProvider
          recipeVersionIds={[recipeVersionId, "recipe-two"]}
        >
          <RecipeCardEngagement
            averageRating={4.5}
            lineageLabel="Original"
            ratingCount={2}
            recipeVersionId={recipeVersionId}
            saveCount={12}
            servings="8 servings"
            title="Carrot Walnut Snack Cake"
          >
            <div>First card</div>
          </RecipeCardEngagement>
          <RecipeCardEngagement
            averageRating={4}
            lineageLabel="Original"
            ratingCount={1}
            recipeVersionId="recipe-two"
            saveCount={3}
            servings="4 servings"
            title="Tomato Soup"
          >
            <div>Second card</div>
          </RecipeCardEngagement>
        </RecipeCardViewerStateProvider>
      </AuthSessionProvider>,
    );

    expect(
      await screen.findByRole("button", {
        name: "Remove saved Carrot Walnut Snack Cake",
      }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "Save Tomato Soup" }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(mocks.fetchRecipeViewerStates).toHaveBeenCalledOnce();
    expect(mocks.fetchRecipeViewerStates).toHaveBeenCalledWith(
      [recipeVersionId, "recipe-two"],
      expect.anything(),
    );
    expect(mocks.fetchRecipeViewerState).not.toHaveBeenCalled();
  });

  it("keeps the previous heart and count when saving fails", async () => {
    mocks.fetchRecipeViewerState.mockResolvedValue({
      recipe_version_id: recipeVersionId,
      saved: false,
      rating: 3,
    });
    mocks.setRecipeSaved.mockRejectedValue(new Error("network unavailable"));
    renderEngagement(member);

    fireEvent.click(
      await screen.findByRole("button", {
        name: "Save Carrot Walnut Snack Cake",
      }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /couldn’t update/i,
    );
    expect(screen.getByText("12 saves")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Save Carrot Walnut Snack Cake" }),
    ).toHaveAttribute("aria-pressed", "false");
  });
});
