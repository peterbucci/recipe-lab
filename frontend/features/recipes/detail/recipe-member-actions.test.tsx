import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "../../../tests/support/deferred";
import type { AuthSession } from "../../auth/auth-api";
import {
  AuthSessionProvider,
  useAuthSession,
} from "../../auth/auth-session-provider";
import type { RecipeViewerState } from "../shared/interaction-api";
import {
  RecipeMemberActions,
  type RecipeEditActionState,
} from "./recipe-member-actions";

const mocks = vi.hoisted(() => ({
  fetchRecipeViewerState: vi.fn(),
}));

vi.mock("../shared/interaction-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../shared/interaction-api")>();
  return { ...actual, fetchRecipeViewerState: mocks.fetchRecipeViewerState };
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
  RecipeViewTracker: ({ recipeVersionId }: { recipeVersionId: string }) => (
    <span data-testid="view-tracker">{recipeVersionId}</span>
  ),
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
const idleEditAction: RecipeEditActionState = {
  activeDrafts: { adaptation: false, revision: false },
  errorMessage: null,
  pendingIntent: null,
};

function SessionSwitches() {
  const { replaceSession } = useAuthSession();
  return (
    <button type="button" onClick={() => replaceSession(bob)}>
      Use Bob
    </button>
  );
}

function renderActions(
  session: AuthSession,
  {
    editAction = idleEditAction,
    onEditActionFocusRestored,
    onRequestEdit = vi.fn(),
    publicPath = `/recipes/${recipeVersionId}`,
    restoreEditActionFocus = false,
    switches = false,
  }: {
    editAction?: RecipeEditActionState;
    onEditActionFocusRestored?: () => void;
    onRequestEdit?: () => void;
    publicPath?: string;
    restoreEditActionFocus?: boolean;
    switches?: boolean;
  } = {},
) {
  return render(
    <AuthSessionProvider initialSession={session}>
      {switches ? <SessionSwitches /> : null}
      <RecipeMemberActions
        averageRating={4.5}
        editAction={editAction}
        onEditActionFocusRestored={onEditActionFocusRestored}
        onRequestEdit={onRequestEdit}
        publicPath={publicPath}
        recipeVersionId={recipeVersionId}
        ratingCount={2}
        saveCount={876}
        restoreEditActionFocus={restoreEditActionFocus}
      />
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRecipeViewerState.mockResolvedValue({
    can_revise: false,
    recipe_version_id: recipeVersionId,
    saved: false,
    rating: null,
  });
});

describe("RecipeMemberActions", () => {
  it("keeps writes and recorded views absent for anonymous visitors", () => {
    renderActions({ status: "anonymous" });

    expect(screen.getByRole("button", { name: "Save recipe" })).toHaveTextContent(
      "Save",
    );
    expect(screen.getByRole("button", { name: "Rate recipe" })).toHaveTextContent(
      "Rate",
    );
    expect(
      screen.getByRole("link", { name: /make your own version/i }),
    ).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
    );
    expect(screen.queryByRole("region", { name: /save and rate/i })).toBeNull();
    expect(screen.getByText("876 saves")).toBeVisible();
    expect(screen.queryByTestId("view-tracker")).toBeNull();
    expect(mocks.fetchRecipeViewerState).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Rate recipe" }));
    expect(
      screen.getByRole("dialog", { name: "Sign in to rate recipes" }),
    ).toHaveTextContent(/ratings help you keep track/i);
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}`,
    );
  });

  it("keeps the direct fork route while account setup is incomplete", () => {
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
    expect(mocks.fetchRecipeViewerState).not.toHaveBeenCalled();
  });

  it("does not choose an edit intent while viewer authorization loads", async () => {
    const viewerState = deferred<RecipeViewerState | null>();
    mocks.fetchRecipeViewerState.mockReturnValueOnce(viewerState.promise);
    const onRequestEdit = vi.fn();
    renderActions(alice, { onRequestEdit });

    const edit = screen.getByRole("button", {
      name: "Checking editing options…",
    });
    expect(edit).toBeDisabled();
    fireEvent.click(edit);
    expect(onRequestEdit).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(
      /loading your saved, rating, and editing options/i,
    );
    expect(screen.queryByTestId("view-tracker")).toBeNull();

    await act(async () => {
      viewerState.resolve({
        can_revise: false,
        recipe_version_id: recipeVersionId,
        saved: false,
        rating: null,
      });
      await viewerState.promise;
    });

    expect(await screen.findByText(/not saved; rating none/i)).toBeVisible();
    const makeVersion = screen.getByRole("button", {
      name: "Make your own version",
    });
    expect(makeVersion).toBeEnabled();
    fireEvent.click(makeVersion);
    expect(onRequestEdit).toHaveBeenCalledWith("adaptation");
    expect(screen.getByTestId("view-tracker")).toHaveTextContent(recipeVersionId);
  });

  it("presents the route-owned continue, pending, and error states", async () => {
    const onRequestEdit = vi.fn();
    const { rerender } = renderActions(alice, {
      editAction: {
        activeDrafts: { adaptation: true, revision: false },
        errorMessage: null,
        pendingIntent: null,
      },
      onRequestEdit,
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Continue your version" }),
    );
    expect(onRequestEdit).toHaveBeenCalledTimes(1);

    rerender(
      <AuthSessionProvider initialSession={alice}>
        <RecipeMemberActions
          averageRating={4.5}
          editAction={{
            activeDrafts: { adaptation: true, revision: false },
            errorMessage: "Safe preparation failure",
            pendingIntent: "adaptation",
          }}
          onRequestEdit={onRequestEdit}
          publicPath={`/recipes/${recipeVersionId}`}
          recipeVersionId={recipeVersionId}
          ratingCount={2}
          saveCount={876}
        />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("button", { name: "Preparing your version…" }),
    ).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Safe preparation failure",
    );
  });

  it("preserves a stable detail route for save and rating authentication", () => {
    const stablePath = "/recipes/current/22222222-2222-4222-8222-222222222222";
    renderActions({ status: "anonymous" }, { publicPath: stablePath });

    fireEvent.click(screen.getByRole("button", { name: "Save recipe" }));
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      `/sign-in?return_to=${encodeURIComponent(stablePath)}`,
    );
    expect(screen.getByRole("link", { name: /make your own version/i })).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
    );
  });

  it("uses backend revision authority for the owner edit action", async () => {
    mocks.fetchRecipeViewerState.mockResolvedValueOnce({
      can_revise: true,
      recipe_version_id: recipeVersionId,
      saved: false,
      rating: null,
    });
    const onRequestEdit = vi.fn();
    renderActions(alice, {
      editAction: {
        activeDrafts: { adaptation: true, revision: false },
        errorMessage: null,
        pendingIntent: null,
      },
      onRequestEdit,
    });

    const edit = await screen.findByRole("button", { name: "Edit recipe" });
    fireEvent.click(edit);
    expect(onRequestEdit).toHaveBeenCalledWith("revision");
    expect(
      screen.queryByRole("button", { name: "Continue your version" }),
    ).toBeNull();
  });

  it("restores edit focus after viewer authorization finishes loading", async () => {
    const viewerState = deferred<RecipeViewerState | null>();
    mocks.fetchRecipeViewerState.mockReturnValueOnce(viewerState.promise);
    const onEditActionFocusRestored = vi.fn();
    renderActions(alice, {
      onEditActionFocusRestored,
      restoreEditActionFocus: true,
    });

    expect(
      screen.getByRole("button", { name: "Checking editing options…" }),
    ).not.toHaveFocus();

    await act(async () => {
      viewerState.resolve({
        can_revise: true,
        recipe_version_id: recipeVersionId,
        saved: false,
        rating: null,
      });
      await viewerState.promise;
    });

    const edit = await screen.findByRole("button", { name: "Edit recipe" });
    await waitFor(() => expect(edit).toHaveFocus());
    expect(onEditActionFocusRestored).toHaveBeenCalledOnce();
  });

  it("keeps version creation available when viewer state fails and retries it", async () => {
    mocks.fetchRecipeViewerState
      .mockRejectedValueOnce(new Error("viewer state unavailable"))
      .mockResolvedValueOnce({
        can_revise: false,
        recipe_version_id: recipeVersionId,
        saved: true,
        rating: 4,
      });

    renderActions(alice);

    expect(
      await screen.findByText(/couldn’t load your saved, rating, and editing options/i),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Checking editing options…" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", {
        name: /retry recipe options/i,
      }),
    );

    expect(await screen.findByText(/saved; rating 4/i)).toBeVisible();
    expect(screen.getByTestId("view-tracker")).toBeVisible();
    expect(mocks.fetchRecipeViewerState).toHaveBeenCalledTimes(2);
  });

  it("never carries viewer state across an account switch", async () => {
    const bobState = deferred<RecipeViewerState | null>();
    mocks.fetchRecipeViewerState
      .mockResolvedValueOnce({
        can_revise: false,
        recipe_version_id: recipeVersionId,
        saved: true,
        rating: 5,
      })
      .mockReturnValueOnce(bobState.promise);
    renderActions(alice, { switches: true });

    expect(await screen.findByText(/saved; rating 5/i)).toBeVisible();
    expect(screen.getByTestId("view-tracker")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: /use bob/i }));

    expect(screen.queryByText(/saved; rating 5/i)).toBeNull();
    expect(screen.queryByTestId("view-tracker")).toBeNull();
    expect(
      screen.getByRole("region", { name: /member recipe actions/i }),
    ).toHaveTextContent(/loading your saved, rating, and editing options/i);

    await act(async () => {
      bobState.resolve({
        can_revise: false,
        recipe_version_id: recipeVersionId,
        saved: false,
        rating: 2,
      });
      await bobState.promise;
    });

    expect(await screen.findByText(/not saved; rating 2/i)).toBeVisible();
    expect(mocks.fetchRecipeViewerState).toHaveBeenCalledTimes(2);
  });
});
