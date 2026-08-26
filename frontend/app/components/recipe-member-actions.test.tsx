import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../lib/auth-api";
import type { RecipeViewerState } from "../../lib/interaction-api";
import { AuthSessionProvider, useAuthSession } from "./auth-session-provider";
import { RecipeMemberActions } from "./recipe-member-actions";

const mocks = vi.hoisted(() => ({
  fetchRecipeViewerState: vi.fn(),
}));

vi.mock("../../lib/interaction-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/interaction-api")>();
  return { ...actual, fetchRecipeViewerState: mocks.fetchRecipeViewerState };
});

vi.mock("./recipe-interaction-panel", () => ({
  RecipeInteractionPanel: ({ initialViewerState }: { initialViewerState: RecipeViewerState }) => (
    <section aria-label="Save and rate this recipe">
      {initialViewerState.saved ? "saved" : "not saved"}; rating {initialViewerState.rating ?? "none"}
    </section>
  ),
}));

vi.mock("./recipe-view-tracker", () => ({
  RecipeViewTracker: () => <span data-testid="view-tracker" />,
}));

const alice: AuthSession = {
  status: "authenticated",
  user: { id: "alice-id", display_name: "Alice", handle: "alice" },
};
const bob: AuthSession = {
  status: "authenticated",
  user: { id: "bob-id", display_name: "Bob", handle: "bob" },
};
const recipeVersionId = "11111111-1111-4111-8111-111111111111";

function SessionSwitches() {
  const { replaceSession } = useAuthSession();
  return (
    <>
      <button type="button" onClick={() => replaceSession(alice)}>Use Alice</button>
      <button type="button" onClick={() => replaceSession(bob)}>Use Bob</button>
    </>
  );
}

function renderActions(session: AuthSession, switches = false) {
  return render(
    <AuthSessionProvider initialSession={session}>
      {switches ? <SessionSwitches /> : null}
      <RecipeMemberActions
        comparison={{
          id: "parent",
          title: "Parent recipe",
          version_number: 1,
          author: { id: "cook-one", handle: "first-cook", display_name: "First Cook" },
        }}
        recipeVersionId={recipeVersionId}
      />
    </AuthSessionProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RecipeMemberActions", () => {
  it("keeps writes and recorded views absent for anonymous visitors", () => {
    renderActions({ status: "anonymous" });

    expect(screen.getByRole("region", { name: /member recipe actions/i })).toHaveTextContent(
      /sign in to save or rate/i,
    );
    expect(screen.getByRole("link", { name: /sign in to make your own version/i })).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
    );
    expect(screen.getByRole("link", { name: /see what changed/i })).toBeVisible();
    expect(screen.queryByRole("region", { name: /save and rate/i })).toBeNull();
    expect(screen.queryByTestId("view-tracker")).toBeNull();
    expect(mocks.fetchRecipeViewerState).not.toHaveBeenCalled();
  });

  it("gates mutations until account setup is complete", () => {
    renderActions({
      status: "onboarding_required",
      user: { id: "pending-id", display_name: "Pending", handle: null },
    });

    expect(screen.getByRole("link", { name: /finish setup to make a version/i })).toHaveAttribute(
      "href",
      `/onboarding?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
    );
    expect(screen.queryByRole("region", { name: /save and rate/i })).toBeNull();
    expect(mocks.fetchRecipeViewerState).not.toHaveBeenCalled();
  });

  it("never carries one member’s private state across an account switch", async () => {
    const bobState = deferred<RecipeViewerState | null>();
    mocks.fetchRecipeViewerState
      .mockResolvedValueOnce({ recipe_version_id: recipeVersionId, saved: true, rating: 5 })
      .mockReturnValueOnce(bobState.promise);
    renderActions(alice, true);

    expect(await screen.findByText(/saved; rating 5/i)).toBeVisible();
    expect(screen.getByTestId("view-tracker")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /use bob/i }));

    expect(screen.queryByText(/saved; rating 5/i)).toBeNull();
    expect(screen.queryByTestId("view-tracker")).toBeNull();
    expect(screen.getByRole("region", { name: /member recipe actions/i })).toHaveTextContent(
      /loading your saved and rating state/i,
    );

    await act(async () => {
      bobState.resolve({ recipe_version_id: recipeVersionId, saved: false, rating: 2 });
      await bobState.promise;
    });

    expect(await screen.findByText(/not saved; rating 2/i)).toBeVisible();
    expect(mocks.fetchRecipeViewerState).toHaveBeenCalledTimes(2);
  });
});
