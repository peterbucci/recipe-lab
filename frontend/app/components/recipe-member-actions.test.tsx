import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import type { AuthSession } from "../../lib/auth-api";
import type { RecipeViewerState } from "../../lib/interaction-api";
import type { RecipeDraftListItem } from "../../lib/recipe-draft-api";
import type { RecipeDraftEditorEntry } from "../../lib/recipe-draft-editor-entry";
import { deferred } from "../../test/deferred";
import { AuthSessionProvider, useAuthSession } from "./auth-session-provider";
import { RecipeMemberActions } from "./recipe-member-actions";

const mocks = vi.hoisted(() => ({
  fetchRecipeViewerState: vi.fn(),
  findActiveRecipeDraftForSource: vi.fn(),
  prepareRecipeDraftEditorEntry: vi.fn(),
  push: vi.fn(),
  recipeDraftEntryErrorMessage: vi.fn(),
  startOrResumeRecipeDraft: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock("../../lib/interaction-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/interaction-api")>();
  return { ...actual, fetchRecipeViewerState: mocks.fetchRecipeViewerState };
});

vi.mock("../../lib/recipe-draft-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/recipe-draft-api")>();
  return {
    ...actual,
    findActiveRecipeDraftForSource: mocks.findActiveRecipeDraftForSource,
  };
});

vi.mock("../../lib/recipe-draft-entry", () => ({
  recipeDraftEntryErrorMessage: mocks.recipeDraftEntryErrorMessage,
  startOrResumeRecipeDraft: mocks.startOrResumeRecipeDraft,
}));

vi.mock("../../lib/recipe-draft-editor-entry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/recipe-draft-editor-entry")>();
  return {
    ...actual,
    prepareRecipeDraftEditorEntry: mocks.prepareRecipeDraftEditorEntry,
  };
});

vi.mock("./recipe-interaction-panel", () => ({
  RecipeInteractionPanel: ({
    initialViewerState,
    primaryAction,
  }: {
    initialViewerState: RecipeViewerState;
    primaryAction: ReactNode;
  }) => (
    <section aria-label="Save and rate this recipe">
      {initialViewerState.saved ? "saved" : "not saved"}; rating{" "}
      {initialViewerState.rating ?? "none"}
      {primaryAction}
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
      <button type="button" onClick={() => replaceSession(alice)}>
        Use Alice
      </button>
      <button type="button" onClick={() => replaceSession(bob)}>
        Use Bob
      </button>
    </>
  );
}

function renderActions(
  session: AuthSession,
  switches = false,
  onEditableVersionReady?: (entry: RecipeDraftEditorEntry) => void | Promise<void>,
  onActiveDraftChange?: (hasActiveDraft: boolean) => void,
) {
  return render(
    <AuthSessionProvider initialSession={session}>
      {switches ? <SessionSwitches /> : null}
      <RecipeMemberActions
        averageRating={4.5}
        comparison={{
          id: "parent",
          title: "Parent recipe",
          version_number: 1,
          author: {
            id: "cook-one",
            handle: "first-cook",
            display_name: "First Cook",
          },
        }}
        onActiveDraftChange={onActiveDraftChange}
        recipeVersionId={recipeVersionId}
        ratingCount={2}
        saveCount={876}
        onEditableVersionReady={onEditableVersionReady}
      />
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findActiveRecipeDraftForSource.mockResolvedValue(null);
  mocks.prepareRecipeDraftEditorEntry.mockReset();
  mocks.recipeDraftEntryErrorMessage.mockReturnValue(
    "Recipe Lab could not start this private draft. Try again to recover the same draft.",
  );
  mocks.startOrResumeRecipeDraft.mockResolvedValue(
    "22222222-2222-4222-8222-222222222222",
  );
});

describe("RecipeMemberActions", () => {
  it("keeps writes and recorded views absent for anonymous visitors", () => {
    renderActions({ status: "anonymous" });

    const saveButton = screen.getByRole("button", { name: "Save recipe" });
    expect(saveButton).toHaveTextContent("Save");
    expect(saveButton.querySelector('svg[data-icon="heart"]')).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Rate recipe" }),
    ).toHaveTextContent("Rate");
    expect(
      screen.getByRole("link", { name: /make your own version/i }),
    ).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
    );
    expect(
      screen.getByRole("link", { name: /see what changed/i }),
    ).toBeVisible();
    expect(screen.queryByRole("region", { name: /save and rate/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Report recipe" })).toBeNull();
    expect(screen.getByText("876 saves")).toBeVisible();
    expect(screen.queryByTestId("view-tracker")).toBeNull();
    expect(mocks.fetchRecipeViewerState).not.toHaveBeenCalled();
    expect(mocks.findActiveRecipeDraftForSource).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Rate recipe" }));
    expect(
      screen.getByRole("dialog", { name: "Sign in to rate recipes" }),
    ).toHaveTextContent(/ratings help you keep track/i);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(
      screen.queryByRole("dialog", { name: "Sign in to rate recipes" }),
    ).toBeNull();
  });

  it("gates mutations until account setup is complete", () => {
    renderActions({
      status: "onboarding_required",
      user: { id: "pending-id", display_name: "Pending", handle: null },
    });

    expect(
      screen.getByRole("link", { name: /make your own version/i }),
    ).toHaveAttribute(
      "href",
      `/onboarding?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
    );
    expect(screen.queryByRole("region", { name: /save and rate/i })).toBeNull();
    expect(mocks.fetchRecipeViewerState).not.toHaveBeenCalled();
    expect(mocks.findActiveRecipeDraftForSource).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Rate recipe" }));
    expect(screen.getByRole("link", { name: "Finish setup" })).toHaveAttribute(
      "href",
      `/onboarding?return_to=%2Frecipes%2F${recipeVersionId}`,
    );
  });

  it("offers version creation while saved and rating state is still loading", async () => {
    const viewerState = deferred<RecipeViewerState | null>();
    mocks.fetchRecipeViewerState.mockReturnValueOnce(viewerState.promise);

    renderActions(alice);

    expect(
      screen.getByRole("button", { name: "Make your own version" }),
    ).toBeEnabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      /loading your saved and rating state/i,
    );
    expect(screen.queryByRole("region", { name: /save and rate/i })).toBeNull();
    expect(screen.queryByTestId("view-tracker")).toBeNull();
    expect(screen.queryByRole("button", { name: "Report recipe" })).toBeNull();

    await act(async () => {
      viewerState.resolve({
        recipe_version_id: recipeVersionId,
        saved: false,
        rating: null,
      });
      await viewerState.promise;
    });

    expect(await screen.findByText(/not saved; rating none/i)).toBeVisible();
    expect(screen.getByTestId("view-tracker")).toBeVisible();
  });

  it("prepares a private version inline before navigating to its canonical draft route", async () => {
    const draftEntry = deferred<string>();
    mocks.fetchRecipeViewerState.mockResolvedValue({
      recipe_version_id: recipeVersionId,
      saved: false,
      rating: null,
    });
    mocks.startOrResumeRecipeDraft.mockReturnValueOnce(draftEntry.promise);

    renderActions(alice);

    expect(await screen.findByText(/not saved; rating none/i)).toBeVisible();
    const makeVersion = screen.getByRole("button", {
      name: "Make your own version",
    });
    fireEvent.click(makeVersion);

    expect(mocks.startOrResumeRecipeDraft).toHaveBeenCalledWith(
      "alice-id",
      recipeVersionId,
    );
    expect(
      screen.getByRole("button", { name: "Preparing your version…" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Preparing your version…" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("876 saves")).toBeVisible();
    expect(
      screen.getByRole("link", { name: /see what changed/i }),
    ).toBeVisible();
    expect(mocks.push).not.toHaveBeenCalled();

    await act(async () => {
      draftEntry.resolve("33333333-3333-4333-8333-333333333333");
      await draftEntry.promise;
    });

    expect(mocks.push).toHaveBeenCalledWith(
      "/recipes/drafts/33333333-3333-4333-8333-333333333333",
    );
  });

  it("keeps the public recipe mounted until the inline editor is completely ready", async () => {
    const preparedEntry = deferred<RecipeDraftEditorEntry>();
    const onEditableVersionReady = vi.fn();
    mocks.fetchRecipeViewerState.mockResolvedValue({
      recipe_version_id: recipeVersionId,
      saved: false,
      rating: null,
    });
    mocks.prepareRecipeDraftEditorEntry.mockReturnValueOnce(
      preparedEntry.promise,
    );

    renderActions(alice, false, onEditableVersionReady);

    expect(await screen.findByText(/not saved; rating none/i)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );

    expect(mocks.prepareRecipeDraftEditorEntry).toHaveBeenCalledWith(
      "alice-id",
      recipeVersionId,
    );
    expect(
      screen.getByRole("button", { name: "Preparing your version…" }),
    ).toBeDisabled();
    expect(screen.getByText("876 saves")).toBeVisible();
    expect(screen.queryByText(/opening your recipe/i)).toBeNull();
    expect(onEditableVersionReady).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();

    const entry = {
      actionTypes: [],
      categories: [],
      detail: {
        id: "33333333-3333-4333-8333-333333333333",
      },
      measurementUnits: [],
    } as unknown as RecipeDraftEditorEntry;
    await act(async () => {
      preparedEntry.resolve(entry);
      await preparedEntry.promise;
    });

    expect(onEditableVersionReady).toHaveBeenCalledWith(entry);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps a safe inline entry error on the recipe and can retry", async () => {
    mocks.fetchRecipeViewerState.mockResolvedValue({
      recipe_version_id: recipeVersionId,
      saved: false,
      rating: null,
    });
    mocks.startOrResumeRecipeDraft
      .mockRejectedValueOnce(new Error("private upstream detail"))
      .mockResolvedValueOnce("44444444-4444-4444-8444-444444444444");
    mocks.recipeDraftEntryErrorMessage.mockReturnValue(
      "Recipe Lab could not prepare your private version. Try again.",
    );

    renderActions(alice);

    expect(await screen.findByText(/not saved; rating none/i)).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recipe Lab could not prepare your private version. Try again.",
    );
    expect(screen.queryByText("private upstream detail")).toBeNull();
    expect(screen.getByText("876 saves")).toBeVisible();
    expect(mocks.push).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );

    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(
        "/recipes/drafts/44444444-4444-4444-8444-444444444444",
      ),
    );
    expect(mocks.startOrResumeRecipeDraft).toHaveBeenCalledTimes(2);
  });

  it("offers the existing private version when the member already has one", async () => {
    const onActiveDraftChange = vi.fn();
    mocks.fetchRecipeViewerState.mockResolvedValue({
      recipe_version_id: recipeVersionId,
      saved: false,
      rating: null,
    });
    mocks.findActiveRecipeDraftForSource.mockResolvedValue({
      id: "22222222-2222-4222-8222-222222222222",
      source_version_id: recipeVersionId,
      status: "active",
      revision: 3,
      title: "Alice's version",
      ingredient_count: 5,
      instruction_count: 4,
      created_at: "2026-08-30T12:00:00Z",
      updated_at: "2026-08-30T13:00:00Z",
    });

    renderActions(alice, false, undefined, onActiveDraftChange);

    expect(
      await screen.findByRole("link", { name: "Continue your version" }),
    ).toHaveAttribute(
      "href",
      "/recipes/drafts/22222222-2222-4222-8222-222222222222",
    );
    expect(
      screen.queryByRole("link", { name: "Make your own version" }),
    ).toBeNull();
    expect(onActiveDraftChange).toHaveBeenLastCalledWith(true);
  });

  it("resumes an existing private version through the same inline transition", async () => {
    const onEditableVersionReady = vi.fn();
    const entry = {
      actionTypes: [],
      categories: [],
      detail: { id: "22222222-2222-4222-8222-222222222222" },
      measurementUnits: [],
    } as unknown as RecipeDraftEditorEntry;
    mocks.fetchRecipeViewerState.mockResolvedValue({
      recipe_version_id: recipeVersionId,
      saved: false,
      rating: null,
    });
    mocks.findActiveRecipeDraftForSource.mockResolvedValue({
      id: entry.detail.id,
      source_version_id: recipeVersionId,
      status: "active",
      revision: 3,
      title: "Alice's version",
      ingredient_count: 5,
      instruction_count: 4,
      created_at: "2026-08-30T12:00:00Z",
      updated_at: "2026-08-30T13:00:00Z",
    });
    mocks.prepareRecipeDraftEditorEntry.mockResolvedValue(entry);

    renderActions(alice, false, onEditableVersionReady);

    fireEvent.click(
      await screen.findByRole("button", { name: "Continue your version" }),
    );
    await waitFor(() =>
      expect(onEditableVersionReady).toHaveBeenCalledWith(entry),
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("keeps version creation active when saved and rating state fails and retries", async () => {
    mocks.fetchRecipeViewerState
      .mockRejectedValueOnce(new Error("viewer state unavailable"))
      .mockResolvedValueOnce({
        recipe_version_id: recipeVersionId,
        saved: true,
        rating: 4,
      });

    renderActions(alice);

    expect(
      await screen.findByText(/couldn’t load your saved and rating state/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Make your own version" }),
    ).toBeEnabled();
    expect(screen.queryByTestId("view-tracker")).toBeNull();

    const retry = screen.getByRole("button", {
      name: /retry saved and rating state/i,
    });
    expect(retry).toHaveClass("button--secondary");
    fireEvent.click(retry);

    expect(
      screen.getByRole("button", { name: "Make your own version" }),
    ).toBeVisible();
    expect(await screen.findByText(/saved; rating 4/i)).toBeVisible();
    expect(screen.getByTestId("view-tracker")).toBeVisible();
    expect(mocks.fetchRecipeViewerState).toHaveBeenCalledTimes(2);
  });

  it("never carries one member’s private state across an account switch", async () => {
    const onActiveDraftChange = vi.fn();
    const bobState = deferred<RecipeViewerState | null>();
    const bobDraft = deferred<RecipeDraftListItem | null>();
    mocks.fetchRecipeViewerState
      .mockResolvedValueOnce({
        recipe_version_id: recipeVersionId,
        saved: true,
        rating: 5,
      })
      .mockReturnValueOnce(bobState.promise);
    mocks.findActiveRecipeDraftForSource
      .mockResolvedValueOnce({
        id: "22222222-2222-4222-8222-222222222222",
        source_version_id: recipeVersionId,
        status: "active",
        revision: 3,
        title: "Alice's version",
        ingredient_count: 5,
        instruction_count: 4,
        created_at: "2026-08-30T12:00:00Z",
        updated_at: "2026-08-30T13:00:00Z",
      })
      .mockReturnValueOnce(bobDraft.promise);
    renderActions(alice, true, undefined, onActiveDraftChange);

    expect(await screen.findByText(/saved; rating 5/i)).toBeVisible();
    expect(
      await screen.findByRole("link", { name: "Continue your version" }),
    ).toBeVisible();
    expect(screen.getByTestId("view-tracker")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Report recipe" })).toBeNull();
    expect(onActiveDraftChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: /use bob/i }));

    expect(onActiveDraftChange).toHaveBeenLastCalledWith(false);

    expect(screen.queryByText(/saved; rating 5/i)).toBeNull();
    expect(screen.queryByTestId("view-tracker")).toBeNull();
    expect(
      screen.queryByRole("link", { name: "Continue your version" }),
    ).toBeNull();
    expect(
      screen.getByRole("button", { name: "Make your own version" }),
    ).toBeVisible();
    expect(
      screen.getByRole("region", { name: /member recipe actions/i }),
    ).toHaveTextContent(/loading your saved and rating state/i);

    await act(async () => {
      bobState.resolve({
        recipe_version_id: recipeVersionId,
        saved: false,
        rating: 2,
      });
      await bobState.promise;
      bobDraft.resolve(null);
      await bobDraft.promise;
    });

    expect(await screen.findByText(/not saved; rating 2/i)).toBeVisible();
    expect(mocks.fetchRecipeViewerState).toHaveBeenCalledTimes(2);
    expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledTimes(2);
  });
});
