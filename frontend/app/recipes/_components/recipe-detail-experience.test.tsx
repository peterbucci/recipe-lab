import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../../features/auth/auth-api";
import {
  AuthSessionProvider,
  useAuthSession,
} from "../../../features/auth/auth-session-provider";
import type { RecipeDraftListItem } from "../../../features/recipes/authoring/draft/recipe-draft-summary";
import type { RecipeDraftEditorEntry } from "../../../features/recipes/authoring/draft/recipe-draft-editor-entry";
import type { RecipeEditActionState } from "../../../features/recipes/detail/recipe-member-actions";
import type { RecipeDetail } from "../../../features/recipes/shared/recipe-contracts";
import { deferred } from "../../../tests/support/deferred";
import { RecipeDetailExperience } from "./recipe-detail-experience";

const SOURCE_A = "11111111-1111-4111-8111-111111111111";
const SOURCE_B = "22222222-2222-4222-8222-222222222222";
const DRAFT_A = "33333333-3333-4333-8333-333333333333";
const DRAFT_B = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  editActionReady: true,
  findActiveRecipeDraftForSource: vi.fn(),
  prepareRecipeDraftEditorEntry: vi.fn(),
  recipeDraftEntryErrorMessage: vi.fn(),
}));

vi.mock(
  "../../../features/recipes/authoring/draft/recipe-draft-api",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../features/recipes/authoring/draft/recipe-draft-api")
      >();
    return {
      ...actual,
      findActiveRecipeDraftForSource: mocks.findActiveRecipeDraftForSource,
    };
  },
);

vi.mock(
  "../../../features/recipes/authoring/draft/recipe-draft-editor-entry",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../features/recipes/authoring/draft/recipe-draft-editor-entry")
      >();
    return {
      ...actual,
      prepareRecipeDraftEditorEntry: mocks.prepareRecipeDraftEditorEntry,
    };
  },
);

vi.mock(
  "../../../features/recipes/authoring/draft/recipe-draft-entry",
  () => ({
    recipeDraftEntryErrorMessage: mocks.recipeDraftEntryErrorMessage,
  }),
);

vi.mock("../../../features/recipes/detail/recipe-detail-view", () => ({
  RecipeDetailView: ({
    editAction,
    onEditActionFocusRestored,
    onRequestEdit,
    recipe,
    restoreEditActionFocus,
  }: {
    editAction: RecipeEditActionState;
    onEditActionFocusRestored: () => void;
    onRequestEdit: (intent: "adaptation" | "revision") => void;
    recipe: RecipeDetail;
    restoreEditActionFocus: boolean;
  }) => {
    useEffect(() => {
      const action = document.querySelector<HTMLButtonElement>(
        "#recipe-edit-action",
      );
      if (
        restoreEditActionFocus &&
        action !== null &&
        !action.disabled
      ) {
        action.focus();
        onEditActionFocusRestored();
      }
    }, [editAction, onEditActionFocusRestored, restoreEditActionFocus]);

    return (
      <article className="recipe-detail">
        <h1>{recipe.title}</h1>
        <p>Public ingredients stay here while preparation runs.</p>
        <button
          id="recipe-edit-action"
          disabled={editAction.pendingIntent !== null || !mocks.editActionReady}
          type="button"
          onClick={() => onRequestEdit("adaptation")}
        >
          {editAction.pendingIntent !== null
            ? "Preparing your version…"
            : editAction.activeDrafts.adaptation
              ? "Continue your version"
              : "Make your own version"}
        </button>
        <button
          disabled={editAction.pendingIntent !== null}
          type="button"
          onClick={() => onRequestEdit("revision")}
        >
          {editAction.pendingIntent === "revision"
            ? "Opening recipe editor…"
            : editAction.activeDrafts.revision
              ? "Continue editing"
              : "Edit recipe"}
        </button>
        {editAction.errorMessage !== null ? (
          <p role="alert">{editAction.errorMessage}</p>
        ) : null}
      </article>
    );
  },
}));

vi.mock("../../../features/recipes/authoring/editor/recipe-draft-editor", () => ({
  RecipeDraftEditor: ({
    familyHistory,
    familyRecipe,
    initialDetail,
    onDoneForNow,
  }: {
    familyHistory: unknown;
    familyRecipe: RecipeDetail;
    initialDetail: { title: string };
    onDoneForNow: () => void;
  }) => {
    const [title, setTitle] = useState(initialDetail.title);
    return (
      <form aria-label="Private recipe draft editor">
        <p>Family source: {familyRecipe.title}</p>
        <p>Family history: {familyHistory ? "available" : "unavailable"}</p>
        <label>
          Recipe title
          <input
            id="draft-title"
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </label>
        <button type="button" onClick={onDoneForNow}>
          Return
        </button>
      </form>
    );
  },
}));

const alice = {
  status: "authenticated",
  user: { id: "alice-id", display_name: "Alice", handle: "alice" },
} satisfies AuthSession;
const bob = {
  status: "authenticated",
  user: { id: "bob-id", display_name: "Bob", handle: "bob" },
} satisfies AuthSession;

function recipe(id: string, title: string): RecipeDetail {
  return {
    id,
    title,
    parent: null,
  } as RecipeDetail;
}

const recipeA = recipe(SOURCE_A, "Banana oat pancakes");
const recipeB = recipe(SOURCE_B, "Blueberry oat pancakes");

function draftListItem(
  id: string,
  sourceVersionId: string,
  draftKind: "adaptation" | "revision" = "adaptation",
): RecipeDraftListItem {
  return {
    draft_kind: draftKind,
    id,
    source_version_id: sourceVersionId,
    status: "active",
    revision: 1,
    title: "Private version",
    ingredient_count: 1,
    instruction_count: 1,
    created_at: "2026-08-30T12:00:00Z",
    updated_at: "2026-08-30T13:00:00Z",
  };
}

function editorEntry(
  sourceVersionId: string,
  draftId: string,
  title: string,
  draftKind: "adaptation" | "revision" = "adaptation",
): RecipeDraftEditorEntry {
  return {
    actionTypes: [],
    categories: [],
    detail: {
      draft_kind: draftKind,
      id: draftId,
      source_version_id: sourceVersionId,
      title,
    },
    measurementUnits: [],
  } as unknown as RecipeDraftEditorEntry;
}

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
      <button
        type="button"
        onClick={() =>
          replaceSession({
            ...alice,
            user: { ...alice.user, display_name: "Alice Again" },
          })
        }
      >
        Refresh Alice
      </button>
    </>
  );
}

function experience(
  recipeDetail: RecipeDetail,
  session: AuthSession = alice,
  publicPath = `/recipes/${recipeDetail.id}`,
) {
  return (
    <AuthSessionProvider initialSession={session}>
      <SessionSwitches />
      <RecipeDetailExperience
        history={null}
        publicPath={publicPath}
        recipe={recipeDetail}
      />
    </AuthSessionProvider>
  );
}

async function settle<T>(pending: ReturnType<typeof deferred<T>>, value: T) {
  await act(async () => {
    pending.resolve(value);
    await pending.promise;
  });
}

describe("RecipeDetailExperience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.editActionReady = true;
    mocks.findActiveRecipeDraftForSource.mockResolvedValue(null);
    mocks.recipeDraftEntryErrorMessage.mockReturnValue(
      "Recipe Lab could not prepare your private version. Try again.",
    );
    window.history.replaceState({}, "", `/recipes/${SOURCE_A}`);
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 0 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the exact adaptation source in a revised recipe breadcrumb", () => {
    const revisedAdaptation = {
      ...recipeA,
      adaptation_source: {
        author: {
          display_name: "Source Cook",
          handle: "source-cook",
          id: "55555555-5555-4555-8555-555555555555",
        },
        id: SOURCE_B,
        title: "Original blueberry pancakes",
        version_number: 1,
      },
      parent: null,
      relation_kind: "revision",
    } as RecipeDetail;

    render(experience(revisedAdaptation));

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(
      within(breadcrumb).getByRole("link", {
        name: "Original blueberry pancakes",
      }),
    ).toHaveAttribute("href", `/recipes/${SOURCE_B}`);
  });

  it("derives the breadcrumb and edit action from the route-owned active draft result", async () => {
    mocks.findActiveRecipeDraftForSource.mockImplementation(
      (_sourceVersionId: string, draftKind: string) =>
        Promise.resolve(
          draftKind === "adaptation"
            ? draftListItem(DRAFT_A, SOURCE_A)
            : null,
        ),
    );

    render(experience(recipeA));

    const breadcrumb = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(breadcrumb).getByRole("link", { name: "Explore" })).toHaveAttribute(
      "href",
      "/recipes",
    );
    expect(
      await screen.findByRole("button", { name: "Continue your version" }),
    ).toBeVisible();
    expect(
      within(breadcrumb).getByRole("link", { name: "My recipes" }),
    ).toHaveAttribute("href", "/account/recipes?view=drafts");
    expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledWith(
      SOURCE_A,
      "adaptation",
      expect.any(AbortSignal),
    );
  });

  it("keeps revision and adaptation drafts separate and opens the requested kind", async () => {
    mocks.findActiveRecipeDraftForSource.mockImplementation(
      (_sourceVersionId: string, draftKind: string) =>
        Promise.resolve(
          draftListItem(
            draftKind === "revision" ? DRAFT_B : DRAFT_A,
            SOURCE_A,
            draftKind as "adaptation" | "revision",
          ),
        ),
    );
    mocks.prepareRecipeDraftEditorEntry.mockResolvedValue(
      editorEntry(SOURCE_A, DRAFT_B, "Owner revision", "revision"),
    );

    render(experience(recipeA));

    fireEvent.click(
      await screen.findByRole("button", { name: "Continue editing" }),
    );
    expect(mocks.prepareRecipeDraftEditorEntry).toHaveBeenCalledWith(
      "alice-id",
      SOURCE_A,
      "revision",
    );
    expect(await screen.findByLabelText("Recipe title")).toHaveValue(
      "Owner revision",
    );
  });

  it("rejects a completed editor entry for a different draft kind", async () => {
    mocks.prepareRecipeDraftEditorEntry.mockResolvedValue(
      editorEntry(SOURCE_A, DRAFT_A, "Wrong intent", "adaptation"),
    );

    render(experience(recipeA));
    fireEvent.click(screen.getByRole("button", { name: "Edit recipe" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not prepare the editable version/i,
    );
    expect(
      screen.queryByRole("form", { name: "Private recipe draft editor" }),
    ).toBeNull();
  });

  it("keeps the public detail mounted until preparation completes", async () => {
    const pending = deferred<RecipeDraftEditorEntry>();
    mocks.prepareRecipeDraftEditorEntry.mockReturnValueOnce(pending.promise);
    Object.defineProperty(window, "scrollX", { configurable: true, value: 4 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 36 });
    const { container } = render(experience(recipeA));

    const readingShell = container.querySelector("main.recipe-reading-page");
    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );

    expect(
      screen.getByText("Public ingredients stay here while preparation runs."),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Preparing your version…" }),
    ).toBeDisabled();
    expect(mocks.prepareRecipeDraftEditorEntry).toHaveBeenCalledWith(
      "alice-id",
      SOURCE_A,
      "adaptation",
    );

    await settle(
      pending,
      editorEntry(SOURCE_A, DRAFT_A, "My banana pancakes"),
    );

    expect(
      screen.getByRole("form", { name: "Private recipe draft editor" }),
    ).toBeVisible();
    expect(container.querySelector("main.recipe-reading-page")).toBe(
      readingShell,
    );
    expect(screen.getByLabelText("Recipe title")).toHaveValue(
      "My banana pancakes",
    );
    expect(screen.getByLabelText("Recipe title")).toHaveFocus();
    expect(window.scrollTo).toHaveBeenLastCalledWith(4, 36);
    expect(window.location.pathname).toBe(`/recipes/${SOURCE_A}`);
  });

  it("revalidates the active draft and restores history and scroll on return", async () => {
    const refreshedDraft = deferred<RecipeDraftListItem | null>();
    mocks.findActiveRecipeDraftForSource
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockReturnValueOnce(refreshedDraft.promise);
    mocks.prepareRecipeDraftEditorEntry.mockResolvedValue(
      editorEntry(SOURCE_A, DRAFT_A, "My banana pancakes"),
    );
    Object.defineProperty(window, "scrollX", { configurable: true, value: 3 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 24 });
    const stablePath = "/recipes/current/99999999-9999-4999-8999-999999999999";
    render(experience(recipeA, alice, stablePath));

    await waitFor(() =>
      expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledTimes(2),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );
    expect(
      await screen.findByRole("form", { name: "Private recipe draft editor" }),
    ).toBeVisible();

    window.history.replaceState(
      {
        __recipeDraftGuard: "remove",
        keep: "preserved",
        recipeLabInlineDraft: DRAFT_A,
      },
      "",
      `/recipes/drafts/${DRAFT_A}`,
    );
    Object.defineProperty(window, "scrollX", { configurable: true, value: 8 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 64 });
    mocks.editActionReady = false;
    fireEvent.click(screen.getByRole("button", { name: "Return" }));

    expect(window.location.pathname).toBe(stablePath);
    expect(window.history.state).toEqual({ keep: "preserved" });
    expect(window.scrollTo).toHaveBeenLastCalledWith(8, 64);
    expect(
      screen.getByRole("button", { name: "Continue your version" }),
    ).toBeDisabled();
    mocks.editActionReady = true;
    await settle(refreshedDraft, draftListItem(DRAFT_A, SOURCE_A));
    await waitFor(() =>
      expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledTimes(3),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Continue your version" }),
      ).toHaveFocus(),
    );
    expect(
      await screen.findByRole("link", { name: "My recipes" }),
    ).toHaveAttribute("href", "/account/recipes?view=drafts");
  });

  it("recovers the same draft after preparation fails and allows a retry", async () => {
    mocks.prepareRecipeDraftEditorEntry
      .mockRejectedValueOnce(new Error("private upstream detail"))
      .mockResolvedValueOnce(
        editorEntry(SOURCE_A, DRAFT_A, "Recovered banana pancakes"),
      );
    mocks.findActiveRecipeDraftForSource
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(draftListItem(DRAFT_A, SOURCE_A));

    render(experience(recipeA));
    await waitFor(() =>
      expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledTimes(2),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recipe Lab could not prepare your private version. Try again.",
    );
    expect(screen.queryByText("private upstream detail")).toBeNull();
    expect(
      await screen.findByRole("button", { name: "Continue your version" }),
    ).toBeEnabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Continue your version" }),
    );
    expect(
      await screen.findByRole("form", { name: "Private recipe draft editor" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Recipe title")).toHaveValue(
      "Recovered banana pancakes",
    );
    expect(mocks.prepareRecipeDraftEditorEntry).toHaveBeenCalledTimes(2);
  });

  it("ignores a source A completion while source B has its own pending attempt", async () => {
    const pendingA = deferred<RecipeDraftEditorEntry>();
    const pendingB = deferred<RecipeDraftEditorEntry>();
    mocks.prepareRecipeDraftEditorEntry
      .mockReturnValueOnce(pendingA.promise)
      .mockReturnValueOnce(pendingB.promise);
    const { rerender } = render(experience(recipeA));

    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );
    rerender(experience(recipeB));
    expect(
      await screen.findByRole("heading", { name: recipeB.title }),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );

    await settle(pendingA, editorEntry(SOURCE_A, DRAFT_A, "Stale A"));
    expect(
      screen.getByRole("button", { name: "Preparing your version…" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("form", { name: "Private recipe draft editor" }),
    ).toBeNull();

    await settle(pendingB, editorEntry(SOURCE_B, DRAFT_B, "Current B"));
    expect(screen.getByLabelText("Recipe title")).toHaveValue("Current B");
    expect(screen.getByText(`Family source: ${recipeB.title}`)).toBeVisible();
  });

  it("ignores stale rejection and an older A result after an A to B to A revisit", async () => {
    const oldA = deferred<RecipeDraftEditorEntry>();
    const currentA = deferred<RecipeDraftEditorEntry>();
    mocks.prepareRecipeDraftEditorEntry
      .mockReturnValueOnce(oldA.promise)
      .mockReturnValueOnce(currentA.promise);
    const { rerender } = render(experience(recipeA));

    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );
    rerender(experience(recipeB));
    rerender(experience(recipeA));
    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );

    await act(async () => {
      oldA.reject(new Error("stale private failure"));
      try {
        await oldA.promise;
      } catch {
        // The old resource owns this rejection and must ignore it.
      }
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Preparing your version…" }),
    ).toBeDisabled();

    await settle(
      currentA,
      editorEntry(SOURCE_A, DRAFT_A, "Current A revisit"),
    );
    expect(screen.getByLabelText("Recipe title")).toHaveValue(
      "Current A revisit",
    );
  });

  it("does not let the previous account complete or clear the current account attempt", async () => {
    const aliceEntry = deferred<RecipeDraftEditorEntry>();
    const bobEntry = deferred<RecipeDraftEditorEntry>();
    mocks.prepareRecipeDraftEditorEntry
      .mockReturnValueOnce(aliceEntry.promise)
      .mockReturnValueOnce(bobEntry.promise);
    render(experience(recipeA));

    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Use Bob" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );

    await settle(
      aliceEntry,
      editorEntry(SOURCE_A, DRAFT_A, "Alice stale version"),
    );
    expect(
      screen.getByRole("button", { name: "Preparing your version…" }),
    ).toBeDisabled();

    await settle(
      bobEntry,
      editorEntry(SOURCE_A, DRAFT_B, "Bob current version"),
    );
    expect(screen.getByLabelText("Recipe title")).toHaveValue(
      "Bob current version",
    );
    expect(mocks.prepareRecipeDraftEditorEntry).toHaveBeenNthCalledWith(
      2,
      "bob-id",
      SOURCE_A,
      "adaptation",
    );
  });

  it("preserves unsaved editor work when the same account session is restored", async () => {
    mocks.prepareRecipeDraftEditorEntry.mockResolvedValue(
      editorEntry(SOURCE_A, DRAFT_A, "Initial private title"),
    );
    render(experience(recipeA));

    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );
    const title = await screen.findByLabelText("Recipe title");
    fireEvent.change(title, { target: { value: "Unsaved recovered title" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh Alice" }));

    expect(screen.getByLabelText("Recipe title")).toHaveValue(
      "Unsaved recovered title",
    );
  });

  it("does not apply a deferred result after the route resource unmounts", async () => {
    const pending = deferred<RecipeDraftEditorEntry>();
    mocks.prepareRecipeDraftEditorEntry.mockReturnValueOnce(pending.promise);
    const { unmount } = render(experience(recipeA));

    fireEvent.click(
      screen.getByRole("button", { name: "Make your own version" }),
    );
    unmount();
    await settle(
      pending,
      editorEntry(SOURCE_A, DRAFT_A, "Unmounted private version"),
    );

    expect(window.scrollTo).not.toHaveBeenCalled();
  });
});
