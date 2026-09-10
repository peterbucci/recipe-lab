import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../../../features/auth/auth-api";
import {
  AuthSessionProvider,
  useAuthSession,
} from "../../../../features/auth/auth-session-provider";
import type { RecipeDraftListItem } from "../../../../features/recipes/authoring/draft/recipe-draft-summary";
import type { RecipeDraftEditorEntry } from "../../../../features/recipes/authoring/draft/recipe-draft-editor-entry";
import type { RecipeEditActionState } from "../../../../features/recipes/detail/recipe-member-actions";
import type { RecipeDetail } from "../../../../features/recipes/shared/recipe-contracts";
import { deferred } from "../../../../tests/support/deferred";
import { RecipeDetailExperience } from "./recipe-detail-experience";

const SOURCE_A = "11111111-1111-4111-8111-111111111111";
const SOURCE_B = "22222222-2222-4222-8222-222222222222";
const DRAFT_A = "33333333-3333-4333-8333-333333333333";
const DRAFT_B = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  findActiveRecipeDraftForSource: vi.fn(),
  prepareRecipeDraftEditorEntry: vi.fn(),
  recipeDraftEntryErrorMessage: vi.fn(),
}));

vi.mock(
  "../../../../features/recipes/authoring/draft/recipe-draft-api",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../features/recipes/authoring/draft/recipe-draft-api")
      >();
    return {
      ...actual,
      findActiveRecipeDraftForSource: mocks.findActiveRecipeDraftForSource,
    };
  },
);

vi.mock(
  "../../../../features/recipes/authoring/draft/recipe-draft-editor-entry",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../../../features/recipes/authoring/draft/recipe-draft-editor-entry")
      >();
    return {
      ...actual,
      prepareRecipeDraftEditorEntry: mocks.prepareRecipeDraftEditorEntry,
    };
  },
);

vi.mock(
  "../../../../features/recipes/authoring/draft/recipe-draft-entry",
  () => ({
    recipeDraftEntryErrorMessage: mocks.recipeDraftEntryErrorMessage,
  }),
);

vi.mock("../../../../features/recipes/detail/recipe-detail-view", () => ({
  RecipeDetailView: ({
    editAction,
    onRequestEdit,
    recipe,
  }: {
    editAction: RecipeEditActionState;
    onRequestEdit: () => void;
    recipe: RecipeDetail;
  }) => (
    <article className="recipe-detail">
      <h1>{recipe.title}</h1>
      <p>Public ingredients stay here while preparation runs.</p>
      <button
        disabled={editAction.pending}
        type="button"
        onClick={onRequestEdit}
      >
        {editAction.pending
          ? "Preparing your version…"
          : editAction.hasActiveDraft
            ? "Continue your version"
            : "Make your own version"}
      </button>
      {editAction.errorMessage !== null ? (
        <p role="alert">{editAction.errorMessage}</p>
      ) : null}
    </article>
  ),
}));

vi.mock("../../../../features/recipes/authoring/editor/recipe-draft-editor", () => ({
  RecipeDraftEditor: ({
    familyRecipe,
    familyVersions,
    initialDetail,
    onDoneForNow,
  }: {
    familyRecipe: RecipeDetail;
    familyVersions: unknown[];
    initialDetail: { title: string };
    onDoneForNow: () => void;
  }) => {
    const [title, setTitle] = useState(initialDetail.title);
    return (
      <form aria-label="Private recipe draft editor">
        <p>Family source: {familyRecipe.title}</p>
        <p>Family versions: {familyVersions.length}</p>
        <label>
          Recipe title
          <input
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
): RecipeDraftListItem {
  return {
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
): RecipeDraftEditorEntry {
  return {
    actionTypes: [],
    categories: [],
    detail: {
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

function experience(recipeDetail: RecipeDetail, session: AuthSession = alice) {
  return (
    <AuthSessionProvider initialSession={session}>
      <SessionSwitches />
      <RecipeDetailExperience
        familyVersions={[]}
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

  it("derives the breadcrumb and edit action from the route-owned active draft result", async () => {
    mocks.findActiveRecipeDraftForSource.mockResolvedValue(
      draftListItem(DRAFT_A, SOURCE_A),
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
      expect.any(AbortSignal),
    );
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
    expect(window.scrollTo).toHaveBeenLastCalledWith(4, 36);
    expect(window.location.pathname).toBe(`/recipes/${SOURCE_A}`);
  });

  it("revalidates the active draft and restores history and scroll on return", async () => {
    mocks.findActiveRecipeDraftForSource
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(draftListItem(DRAFT_A, SOURCE_A));
    mocks.prepareRecipeDraftEditorEntry.mockResolvedValue(
      editorEntry(SOURCE_A, DRAFT_A, "My banana pancakes"),
    );
    Object.defineProperty(window, "scrollX", { configurable: true, value: 3 });
    Object.defineProperty(window, "scrollY", { configurable: true, value: 24 });
    render(experience(recipeA));

    await waitFor(() =>
      expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledTimes(1),
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
    fireEvent.click(screen.getByRole("button", { name: "Return" }));

    expect(window.location.pathname).toBe(`/recipes/${SOURCE_A}`);
    expect(window.history.state).toEqual({ keep: "preserved" });
    expect(window.scrollTo).toHaveBeenLastCalledWith(8, 64);
    await waitFor(() =>
      expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledTimes(2),
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
      .mockResolvedValueOnce(draftListItem(DRAFT_A, SOURCE_A));

    render(experience(recipeA));
    await waitFor(() =>
      expect(mocks.findActiveRecipeDraftForSource).toHaveBeenCalledTimes(1),
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
