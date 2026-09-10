import {
  act,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { deferred } from "../../../tests/support/deferred";
import type { AuthSession } from "../../auth/auth-api";
import {
  AuthSessionProvider,
  useAuthSession,
} from "../../auth/auth-session-provider";
import type { RecipeViewerState } from "./interaction-api";
import {
  RecipeMemberActions,
  type RecipeEditActionState,
} from "./recipe-member-actions";

const mocks = vi.hoisted(() => ({
  fetchRecipeViewerState: vi.fn(),
}));

vi.mock("./interaction-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("./interaction-api")>();
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
  errorMessage: null,
  hasActiveDraft: false,
  pending: false,
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
    onRequestEdit = vi.fn(),
    switches = false,
  }: {
    editAction?: RecipeEditActionState;
    onRequestEdit?: () => void;
    switches?: boolean;
  } = {},
) {
  return render(
    <AuthSessionProvider initialSession={session}>
      {switches ? <SessionSwitches /> : null}
      <RecipeMemberActions
        averageRating={4.5}
        editAction={editAction}
        onRequestEdit={onRequestEdit}
        recipeVersionId={recipeVersionId}
        ratingCount={2}
        saveCount={876}
      />
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchRecipeViewerState.mockResolvedValue({
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

  it("keeps the route edit action available while viewer state loads", async () => {
    const viewerState = deferred<RecipeViewerState | null>();
    mocks.fetchRecipeViewerState.mockReturnValueOnce(viewerState.promise);
    const onRequestEdit = vi.fn();
    renderActions(alice, { onRequestEdit });

    const edit = screen.getByRole("button", {
      name: "Make your own version",
    });
    expect(edit).toBeEnabled();
    fireEvent.click(edit);
    expect(onRequestEdit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(
      /loading your saved and rating state/i,
    );
    expect(screen.queryByTestId("view-tracker")).toBeNull();

    await act(async () => {
      viewerState.resolve({
        recipe_version_id: recipeVersionId,
        saved: false,
        rating: null,
      });
      await viewerState.promise;
    });

    expect(await screen.findByText(/not saved; rating none/i)).toBeVisible();
    expect(screen.getByTestId("view-tracker")).toHaveTextContent(recipeVersionId);
  });

  it("presents the route-owned continue, pending, and error states", () => {
    const onRequestEdit = vi.fn();
    const { rerender } = renderActions(alice, {
      editAction: {
        errorMessage: null,
        hasActiveDraft: true,
        pending: false,
      },
      onRequestEdit,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Continue your version" }),
    );
    expect(onRequestEdit).toHaveBeenCalledTimes(1);

    rerender(
      <AuthSessionProvider initialSession={alice}>
        <RecipeMemberActions
          averageRating={4.5}
          editAction={{
            errorMessage: "Safe preparation failure",
            hasActiveDraft: true,
            pending: true,
          }}
          onRequestEdit={onRequestEdit}
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

  it("keeps version creation available when viewer state fails and retries it", async () => {
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

    fireEvent.click(
      screen.getByRole("button", {
        name: /retry saved and rating state/i,
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
    ).toHaveTextContent(/loading your saved and rating state/i);

    await act(async () => {
      bobState.resolve({
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
