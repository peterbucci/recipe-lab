import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "../../lib/auth-api";
import type { RecipeDetail } from "../../lib/recipe-api";
import type { RecipeDraftDetail } from "../../lib/recipe-draft-api";
import { RecipeDraftApiError } from "../../lib/recipe-draft-api";
import {
  AuthSessionProvider,
  SessionRecoveryNotice,
} from "./auth-session-provider";
import { NavigationBlockerProvider } from "./navigation-blocker-provider";
import {
  RecipeDraftEditor,
  RecipeDraftLoadingView,
} from "./recipe-draft-editor";

const mocks = vi.hoisted(() => ({
  discardRecipeDraft: vi.fn(),
  fetchActiveRecipeCategories: vi.fn(),
  fetchRecipeDraft: vi.fn(),
  key: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  updateRecipeDraft: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => `/recipes/drafts/${DRAFT_ID}`,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: () => mocks.key(),
}));

vi.mock("../../lib/recipe-draft-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/recipe-draft-api")>();
  return {
    ...actual,
    discardRecipeDraft: mocks.discardRecipeDraft,
    fetchRecipeDraft: mocks.fetchRecipeDraft,
    updateRecipeDraft: mocks.updateRecipeDraft,
  };
});

vi.mock("../../lib/recipe-category-client-api", () => ({
  fetchActiveRecipeCategories: mocks.fetchActiveRecipeCategories,
}));

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const INGREDIENT_ROW_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "33333333-3333-4333-8333-333333333333";
const CATEGORY_ID = "77777777-7777-4777-8777-777777777777";
const category = {
  id: CATEGORY_ID,
  name: "Quick & easy",
  slug: "quick-easy",
};
const detail: RecipeDraftDetail = {
  id: DRAFT_ID,
  source_version_id: null,
  status: "active",
  revision: 3,
  title: "",
  description: null,
  servings: null,
  total_time_minutes: null,
  active_time_minutes: null,
  difficulty: null,
  notes: null,
  categories: [],
  ingredients: [],
  instructions: [],
  created_at: "2026-08-25T12:00:00Z",
  updated_at: "2026-08-25T12:00:00Z",
};

const detailWithBoundCookingAction: RecipeDraftDetail = {
  ...detail,
  title: "Bound tomato soup",
  servings: "2",
  ingredients: [
    {
      id: INGREDIENT_ROW_ID,
      display_order: 0,
      selection: {
        kind: "catalog",
        ingredient: {
          id: "44444444-4444-4444-8444-444444444444",
          canonical_name: "tomato",
          aliases: [],
        },
        display_name: "Tomato",
      },
      measure: {
        kind: "qualitative",
        value: "as_needed",
        unit: null,
        display_unit: null,
        display: "as needed",
      },
      preparation_notes: null,
    },
  ],
  instructions: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      title: null,
      display_order: 0,
      text: "Stir in the tomato.",
      actions: [
        {
          id: ACTION_ID,
          display_order: 0,
          action_type: {
            id: "66666666-6666-4666-8666-666666666666",
            key: "stir",
            canonical_verb: "stir",
            active: true,
          },
          ingredient_occurrence_ids: [INGREDIENT_ROW_ID],
          duration: null,
          temperature: null,
        },
      ],
    },
  ],
};

function publicSourceRecipe(
  id: string,
  title = "Public tomato soup",
): RecipeDetail {
  return {
    id,
    lineage_id: "33333333-3333-4333-8333-333333333333",
    parent_version_id: null,
    version_number: 1,
    title,
    description: "The public source recipe.",
    servings: "2",
    created_at: "2026-08-20T12:00:00Z",
    published_at: "2026-08-20T12:00:00Z",
    author: {
      id: "source-author",
      display_name: "Source Cook",
      handle: "source-cook",
    },
    parent: null,
    categories: [],
    average_rating: null,
    rating_count: 0,
    save_count: 0,
    total_time_minutes: null,
    active_time_minutes: null,
    difficulty: null,
    notes: null,
    viewer_state: null,
    children: [],
    ingredients: [],
    instructions: [],
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderEditor(
  initialDetail?: RecipeDraftDetail,
  onDoneForNow?: () => void,
  familyRecipe?: RecipeDetail,
  embedded = false,
) {
  return render(
    <NavigationBlockerProvider>
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "member", display_name: "Member", handle: "member" },
        }}
      >
        <SessionRecoveryNotice />
        <RecipeDraftEditor
          draftId={DRAFT_ID}
          embedded={embedded}
          familyRecipe={familyRecipe}
          familyVersions={familyRecipe ? [] : undefined}
          initialCategories={initialDetail === undefined ? undefined : []}
          initialDetail={initialDetail}
          measurementUnits={[]}
          onDoneForNow={onDoneForNow}
          actionTypes={[]}
        />
      </AuthSessionProvider>
    </NavigationBlockerProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RecipeDraftEditor", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    mocks.discardRecipeDraft.mockReset().mockResolvedValue(undefined);
    mocks.fetchActiveRecipeCategories.mockReset().mockResolvedValue({
      items: [category],
    });
    mocks.fetchRecipeDraft.mockReset().mockResolvedValue(detail);
    mocks.key.mockReset().mockReturnValue("draft-save-key");
    mocks.updateRecipeDraft.mockReset();
    mocks.refresh.mockReset();
    mocks.replace.mockReset();
  });

  it("renders a prepared draft immediately without showing the editor loading screen", () => {
    renderEditor({
      ...detail,
      title: "Prepared tomato soup",
      source_version_id: "99999999-9999-4999-8999-999999999999",
    });

    expect(
      screen.getByRole("form", { name: "Private recipe draft editor" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue("Prepared tomato soup");
    expect(screen.queryByText("Opening your recipe…")).toBeNull();
    expect(screen.queryByText(/loading your private draft/i)).toBeNull();
    expect(screen.queryByText("Loading curated categories…")).toBeNull();
    expect(screen.getByText("All changes are saved privately.")).toHaveClass(
      "visually-hidden",
    );
    expect(
      screen
        .getByLabelText("Draft actions")
        .parentElement?.querySelector('[role="status"]'),
    ).toBeNull();
    expect(mocks.fetchRecipeDraft).not.toHaveBeenCalled();
  });

  it("reuses the recipe page shell when the prepared editor is embedded", () => {
    const { container } = renderEditor(detail, undefined, undefined, true);

    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelector(".recipe-draft-inline")).toContainElement(
      screen.getByRole("form", { name: "Private recipe draft editor" }),
    );
  });

  it("reuses the route-shaped authoring skeleton while a private draft loads", () => {
    const { container } = render(
      <NavigationBlockerProvider>
        <RecipeDraftLoadingView draftId={DRAFT_ID} />
      </NavigationBlockerProvider>,
    );

    const loader = container.querySelector("main.page-loading--authoring");
    expect(loader).toHaveAttribute("aria-busy", "true");
    expect(loader).toHaveClass("recipe-workspace-page");
    expect(loader?.querySelector(".page-loading__recipe")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading your private draft…",
    );
    expect(screen.queryByText("Opening editor…")).toBeNull();
    expect(screen.queryByText("Opening your recipe…")).toBeNull();
  });

  it("shows zero public saves for a private draft", () => {
    renderEditor(detail);

    const noRatings = screen.getByLabelText("No ratings yet");
    const socialRow = noRatings.closest<HTMLElement>(
      ".recipe-detail__social-row",
    );

    expect(within(socialRow!).getByText("0 saves")).toBeVisible();
  });

  it("does not borrow the source recipe's saves for a private version draft", () => {
    const sourceId = "88888888-8888-4888-8888-888888888888";
    renderEditor(
      { ...detail, source_version_id: sourceId },
      undefined,
      { ...publicSourceRecipe(sourceId), save_count: 876 },
    );

    const socialRow = screen
      .getByLabelText("No ratings yet")
      .closest<HTMLElement>(".recipe-detail__social-row");

    expect(within(socialRow!).getByText("0 saves")).toBeVisible();
    expect(within(socialRow!).queryByText("876 saves")).toBeNull();
  });

  it("uses the inline return action when the editor came from a recipe view", () => {
    const onDoneForNow = vi.fn();
    renderEditor(detail, onDoneForNow);

    expect(screen.queryByRole("link", { name: "Return" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Return" }));

    expect(onDoneForNow).toHaveBeenCalledOnce();
  });

  it("keeps unsaved inline edits open when leaving is canceled", () => {
    const onDoneForNow = vi.fn();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor(detail, onDoneForNow);
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Unsaved tomato soup" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Return" }));

    expect(confirm).toHaveBeenCalledWith(
      "You have unsaved recipe changes. Leave without saving them?",
    );
    expect(onDoneForNow).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Title")).toHaveValue("Unsaved tomato soup");
  });

  it("saves only curated category identifiers with the private draft", async () => {
    mocks.updateRecipeDraft.mockResolvedValue({
      ...detail,
      revision: 4,
      categories: [category],
    });
    renderEditor();

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit categories" }),
    );
    fireEvent.click(
      await screen.findByRole(
        "checkbox",
        { name: "Quick & easy" },
        { timeout: 5_000 },
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(mocks.updateRecipeDraft).toHaveBeenCalledWith(
        DRAFT_ID,
        expect.objectContaining({ category_ids: [CATEGORY_ID] }),
        "draft-save-key",
      ),
    );
    expect(
      screen.getByRole("checkbox", { name: "Quick & easy" }),
    ).toBeChecked();
  });

  it("hydrates and saves cooking times, difficulty, and notes", async () => {
    const metadataDetail: RecipeDraftDetail = {
      ...detail,
      total_time_minutes: 45,
      active_time_minutes: 20,
      difficulty: "medium",
      notes: "Rest before serving.",
    };
    mocks.fetchRecipeDraft.mockResolvedValue(metadataDetail);
    mocks.updateRecipeDraft.mockResolvedValue({
      ...metadataDetail,
      revision: 4,
      total_time_minutes: 60,
      active_time_minutes: 25,
      difficulty: "hard",
      notes: "Cool for ten minutes.",
    });
    renderEditor();

    expect(await screen.findByLabelText("Total time")).toHaveValue(45);
    expect(screen.getByLabelText("Active time")).toHaveValue(20);
    expect(screen.getByLabelText("Difficulty")).toHaveValue("medium");
    const recipeNotes = screen.getByLabelText("Recipe notes");
    expect(recipeNotes).toHaveValue("Rest before serving.");
    expect(recipeNotes).toHaveClass("recipe-workspace__editable-text");

    fireEvent.change(screen.getByLabelText("Total time"), {
      target: { value: "60" },
    });
    fireEvent.change(screen.getByLabelText("Active time"), {
      target: { value: "25" },
    });
    fireEvent.change(screen.getByLabelText("Difficulty"), {
      target: { value: "hard" },
    });
    fireEvent.change(screen.getByLabelText("Recipe notes"), {
      target: { value: "Cool for ten minutes." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(mocks.updateRecipeDraft).toHaveBeenCalledWith(
        DRAFT_ID,
        expect.objectContaining({
          total_time_minutes: 60,
          active_time_minutes: 25,
          difficulty: "hard",
          notes: "Cool for ten minutes.",
        }),
        "draft-save-key",
      ),
    );
  });

  it("keeps a backend-authoritative category rejection attached to the selector", async () => {
    mocks.updateRecipeDraft.mockRejectedValue(
      new RecipeDraftApiError(
        "Some draft fields need attention.",
        422,
        "invalid_recipe_draft",
        [
          {
            location: ["body", "category_ids", 0],
            message: "Review the recipe categories.",
            type: "validation_error",
          },
        ],
      ),
    );
    renderEditor();

    fireEvent.click(
      await screen.findByRole("button", { name: "Edit categories" }),
    );
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Quick & easy" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(
      await screen.findByText("Review the recipe categories."),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: "Quick & easy" }),
    ).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Review the highlighted fields. Your edits are still here.",
    );
  });

  it("preserves local fields and offers explicit reconciliation after a stale revision", async () => {
    mocks.updateRecipeDraft.mockRejectedValue(
      new RecipeDraftApiError(
        "The draft has a newer saved revision.",
        409,
        "recipe_draft_revision_conflict",
      ),
    );
    renderEditor();

    const title = await screen.findByLabelText("Title");
    expect(title.closest("main")).toHaveClass(
      "draft-editor-page",
      "draft-editor-page--ready",
    );
    fireEvent.change(title, { target: { value: "My unsaved soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(mocks.updateRecipeDraft).toHaveBeenCalledWith(
        DRAFT_ID,
        expect.objectContaining({ revision: 3, title: "My unsaved soup" }),
        "draft-save-key",
      ),
    );
    expect(screen.getByLabelText("Title")).toHaveValue("My unsaved soup");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "changed in another tab",
    );
    expect(
      screen.getByRole("button", { name: "Reload saved version" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open saved version in a new tab" }),
    ).toHaveAttribute("target", "_blank");
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(
      screen.getByRole("button", { name: "Reload saved version" }),
    );
    expect(confirm).toHaveBeenCalledWith(
      "Replace your unsaved version with the latest saved version?",
    );
    expect(mocks.fetchRecipeDraft).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Title")).toHaveValue("My unsaved soup");
  });

  it("keeps dirty work mounted and restores focus when recovery is postponed", async () => {
    renderEditor();
    const title = await screen.findByLabelText("Title");
    title.focus();
    fireEvent.change(title, { target: { value: "Keep this private work" } });

    fireEvent(window, new Event(AUTH_SESSION_EXPIRED_EVENT));

    expect(screen.getByLabelText("Title")).toHaveValue(
      "Keep this private work",
    );
    expect(
      screen.getByRole("form", { name: "Private recipe draft editor" }),
    ).toBeVisible();
    expect(screen.getByText("You have unsaved changes.")).toHaveClass(
      "visually-hidden",
    );
    const interruption = await screen.findByRole("alert", {
      name: "Your session expired. Your work is still here.",
    });
    await waitFor(() => expect(interruption).toHaveFocus());
    expect(
      screen.getByRole("link", { name: "Sign in in a new tab" }),
    ).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2Fdrafts%2F${DRAFT_ID}`,
    );
    expect(
      screen.getByRole("link", { name: "Sign in in a new tab" }),
    ).toHaveAttribute("target", "_blank");

    fireEvent.click(
      screen.getByRole("button", { name: "Keep editing for now" }),
    );
    expect(
      screen.getByText(/Sign-in is still required before saving/),
    ).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue(
      "Keep this private work",
    );
    await waitFor(() => expect(title).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Resume sign-in" }));
    const resumed = await screen.findByRole("alert", {
      name: "Your session expired. Your work is still here.",
    });
    await waitFor(() => expect(resumed).toHaveFocus());
  });

  it("recovers the original editor after sign-in without losing unsaved values", async () => {
    const recovery = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>().mockReturnValue(recovery.promise);
    vi.stubGlobal("fetch", fetchMock);
    renderEditor();
    const title = await screen.findByLabelText("Title");
    title.focus();
    fireEvent.change(title, { target: { value: "Unsaved recovery stew" } });
    fireEvent(window, new Event(AUTH_SESSION_EXPIRED_EVENT));

    const interruption = await screen.findByRole("alert", {
      name: "Your session expired. Your work is still here.",
    });
    await waitFor(() => expect(interruption).toHaveFocus());
    fireEvent.click(screen.getByRole("button", { name: "Check sign-in" }));

    const checking = screen.getByRole("button", { name: "Checking sign-in…" });
    expect(checking).toHaveAttribute("aria-busy", "true");
    expect(interruption).not.toHaveTextContent("Checking whether sign-in finished");

    recovery.resolve(
      Response.json({
        status: "authenticated",
        user: { id: "member", display_name: "Member", handle: "member" },
      }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("alert", {
          name: "Your session expired. Your work is still here.",
        }),
      ).toBeNull(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({ method: "GET" }),
    );
    expect(screen.getByLabelText("Title")).toHaveValue("Unsaved recovery stew");
    expect(screen.getByText("You have unsaved changes.")).toHaveClass(
      "visually-hidden",
    );
    await waitFor(() => expect(title).toHaveFocus());
  });

  it("keeps recovery available when sign-in is canceled", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ status: "anonymous" })),
    );
    renderEditor();
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Do not discard this" } });
    fireEvent(window, new Event(AUTH_SESSION_EXPIRED_EVENT));

    fireEvent.click(
      await screen.findByRole("button", { name: "Check sign-in" }),
    );

    expect(
      await screen.findByText(
        "Sign-in is not complete. Your work is still here.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue("Do not discard this");
    expect(screen.getByRole("button", { name: "Check sign-in" })).toBeEnabled();
    await waitFor(() =>
      expect(
        screen.getByRole("alert", {
          name: "Your session expired. Your work is still here.",
        }),
      ).toHaveFocus(),
    );
  });

  it("does not restore a private editor under a different account", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          status: "authenticated",
          user: {
            id: "different-member",
            display_name: "Other Member",
            handle: "other",
          },
        }),
      ),
    );
    renderEditor();
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, {
      target: { value: "Alice's private unsaved work" },
    });
    fireEvent(window, new Event(AUTH_SESSION_EXPIRED_EVENT));

    fireEvent.click(
      await screen.findByRole("button", { name: "Check sign-in" }),
    );

    expect(
      await screen.findByText(
        "A different account is signed in. Sign back in as the account that owns this work.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue(
      "Alice's private unsaved work",
    );
    expect(
      screen.getByRole("alert", {
        name: "Your session expired. Your work is still here.",
      }),
    ).toBeVisible();
  });

  it("moves an ordinary save from dirty to saving to saved", async () => {
    const save = deferred<RecipeDraftDetail>();
    mocks.updateRecipeDraft.mockReturnValue(save.promise);
    renderEditor();

    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Saved soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    const savingButton = await screen.findByRole("button", {
      name: "Saving…",
    });
    expect(savingButton).toBeDisabled();
    expect(savingButton).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByText("Saving your private draft…"),
    ).not.toBeInTheDocument();
    expect(
      screen
        .getByLabelText("Draft actions")
        .parentElement?.querySelector('[role="status"]'),
    ).toBeNull();
    save.resolve({
      ...detail,
      revision: 4,
      title: "Saved soup",
      updated_at: "2026-08-25T12:01:00Z",
    });

    expect(await screen.findByText("Draft saved privately.")).toHaveClass(
      "visually-hidden",
    );
    expect(screen.getByRole("button", { name: "Draft saved" })).toBeDisabled();
    expect(title).toHaveValue("Saved soup");
  });

  it("retries the same failed save attempt with the same idempotency key", async () => {
    mocks.key
      .mockReset()
      .mockReturnValueOnce("first-save-key")
      .mockReturnValue("unused-key");
    mocks.updateRecipeDraft
      .mockRejectedValueOnce(new RecipeDraftApiError("Unavailable", 503))
      .mockResolvedValueOnce({
        ...detail,
        revision: 4,
        title: "Retry soup",
        updated_at: "2026-08-25T12:01:00Z",
      });
    renderEditor();

    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Retry soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(
      await screen.findByText(
        "Recipe Lab could not save this draft. Your edits are still here.",
      ),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(mocks.updateRecipeDraft).toHaveBeenCalledTimes(2),
    );
    expect(mocks.updateRecipeDraft.mock.calls.map((call) => call[2])).toEqual([
      "first-save-key",
      "first-save-key",
    ]);
    expect(await screen.findByText("Draft saved privately.")).toHaveClass(
      "visually-hidden",
    );
  });

  it("reuses a failed save attempt after an edit is changed back", async () => {
    mocks.key
      .mockReset()
      .mockReturnValueOnce("first-save-key")
      .mockReturnValue("unused-key");
    mocks.updateRecipeDraft
      .mockRejectedValueOnce(new TypeError("The response was lost"))
      .mockResolvedValueOnce({
        ...detail,
        revision: 4,
        title: "Retry soup",
        updated_at: "2026-08-25T12:01:00Z",
      });
    renderEditor();

    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Retry soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(
      await screen.findByText(
        "Recipe Lab could not save this draft. Your edits are still here.",
      ),
    ).toBeVisible();

    fireEvent.change(title, { target: { value: "Temporary wording" } });
    fireEvent.change(title, { target: { value: "Retry soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() =>
      expect(mocks.updateRecipeDraft).toHaveBeenCalledTimes(2),
    );
    expect(mocks.updateRecipeDraft.mock.calls.map((call) => call[2])).toEqual([
      "first-save-key",
      "first-save-key",
    ]);
    expect(await screen.findByText("Draft saved privately.")).toHaveClass(
      "visually-hidden",
    );
  });

  it("does not let a completed save overwrite newer local edits", async () => {
    const firstSave = deferred<RecipeDraftDetail>();
    mocks.updateRecipeDraft
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce({
        ...detail,
        revision: 5,
        title: "Newer local title",
        updated_at: "2026-08-25T12:02:00Z",
      });
    renderEditor();
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Submitted title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateRecipeDraft).toHaveBeenCalledOnce());

    expect(title).toBeEnabled();
    fireEvent.change(title, { target: { value: "Newer local title" } });
    firstSave.resolve({
      ...detail,
      revision: 4,
      title: "Submitted title",
      updated_at: "2026-08-25T12:01:00Z",
    });

    expect(
      await screen.findByText(
        "Earlier changes saved. Your newer edits are still unsaved.",
      ),
    ).toHaveClass("visually-hidden");
    expect(title).toHaveValue("Newer local title");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() =>
      expect(mocks.updateRecipeDraft).toHaveBeenCalledTimes(2),
    );
    expect(mocks.updateRecipeDraft).toHaveBeenLastCalledWith(
      DRAFT_ID,
      expect.objectContaining({ revision: 4, title: "Newer local title" }),
      "draft-save-key",
    );
    expect(await screen.findByText("Draft saved privately.")).toHaveClass(
      "visually-hidden",
    );
  });

  it("keeps newer local edits and hides backend details after a failed save", async () => {
    const failedSave = deferred<RecipeDraftDetail>();
    mocks.updateRecipeDraft.mockReturnValue(failedSave.promise);
    renderEditor();
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Submitted title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateRecipeDraft).toHaveBeenCalledOnce());
    fireEvent.change(title, { target: { value: "Newer local title" } });
    failedSave.reject(
      new RecipeDraftApiError(
        "Canonical occurrence 99999999-9999-4999-8999-999999999999 failed.",
        503,
      ),
    );

    expect(
      await screen.findByText(
        "Recipe Lab could not save this draft. Your edits are still here.",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/canonical|occurrence|99999999/i)).toBeNull();
    expect(title).toHaveValue("Newer local title");
  });

  it("offers publication review for an original draft", async () => {
    renderEditor();
    const finish = await screen.findByRole("button", { name: "Finish recipe" });
    expect(finish).toHaveAttribute("aria-haspopup", "dialog");
    expect(
      screen.queryByRole("dialog", {
        name: "Ready to share your recipe?",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Review and publish" }),
    ).toBeNull();

    fireEvent.click(finish);

    const dialog = await screen.findByRole("dialog", {
      name: "Ready to share your recipe?",
    });
    expect(dialog).toBeVisible();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(
      "aria-describedby",
      "recipe-workspace-finish-summary",
    );
    expect(document.body).toHaveStyle({ overflow: "hidden" });
    expect(
      within(dialog).getByRole("button", { name: "Review and publish" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", {
          name: "Close publish dialog",
        }),
      ).toHaveFocus(),
    );

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", {
        name: "Ready to share your recipe?",
      }),
    ).toBeNull();
    expect(document.body).not.toHaveStyle({ overflow: "hidden" });
    await waitFor(() => expect(finish).toHaveFocus());
  });

  it("opens the affected cooking breakdown without losing a prose-only saved draft", async () => {
    mocks.fetchRecipeDraft.mockResolvedValue({
      ...detailWithBoundCookingAction,
      instructions: detailWithBoundCookingAction.instructions.map(
        (instruction) => ({
          ...instruction,
          actions: [],
        }),
      ),
    });
    renderEditor();

    const instruction = await screen.findByLabelText("Instruction");
    fireEvent.click(screen.getByRole("button", { name: "Finish recipe" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /right to share this recipe.*community rules/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));

    expect(
      await screen.findByRole("heading", {
        name: "Your draft needs attention",
      }),
    ).toBeVisible();
    expect(instruction).toHaveValue("Stir in the tomato.");
    expect(
      screen.getByText(
        "Add at least one cooking detail to this step so Recipe Lab can compare similar recipes before publishing.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("tab", { name: "Steps" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    ).toHaveAttribute("aria-selected", "true");

    const addDetail = screen.getByRole("button", {
      name: "Add cooking detail to Step 1",
    });
    expect(addDetail).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Cooking detail 1 for Step 1" }),
    ).toBeNull();

    fireEvent.click(addDetail);

    const dialog = screen.getByRole("dialog", {
      name: "Cooking detail 1 for Step 1",
    });
    expect(dialog).toBeVisible();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("combobox", { name: "Cooking action" }),
      ).toHaveFocus(),
    );
  });

  it("preserves the public recipe landmarks while exposing blank-recipe editing controls", async () => {
    renderEditor();

    const form = await screen.findByRole("form", {
      name: "Private recipe draft editor",
    });
    expect(form).toHaveClass("draft-editor--authoring");
    const recipe = form.querySelector<HTMLElement>(
      ".recipe-detail.recipe-workspace",
    );
    const header = recipe?.querySelector<HTMLElement>(".recipe-detail__header");
    const hero = header?.querySelector<HTMLElement>(".recipe-detail__hero");
    const artwork = hero?.querySelector<HTMLElement>(".recipe-detail__artwork");
    const intro = hero?.querySelector<HTMLElement>(".recipe-detail__intro");
    const facts = intro?.querySelector<HTMLElement>(".recipe-detail__facts");
    const actions = intro?.querySelector<HTMLElement>(
      ".recipe-detail__member-actions",
    );
    const socialRow = actions?.querySelector<HTMLElement>(
      ".recipe-detail__social-row",
    );
    const actionStrip = actions?.querySelector<HTMLElement>(
      ".recipe-action-strip",
    );
    const tabs = recipe?.querySelector<HTMLElement>(".recipe-detail__tabs");
    const body = tabs?.querySelector<HTMLElement>(".recipe-detail__body");
    const ingredients = body?.querySelector<HTMLElement>(".ingredient-panel");
    const instructions = body?.querySelector<HTMLElement>(".instruction-panel");

    expect(recipe).toBeVisible();
    expect(header).toBeVisible();
    expect(hero).toBeVisible();
    expect(artwork).toBeVisible();
    expect(intro).toBeVisible();
    expect(hero?.firstElementChild).toBe(artwork);
    expect(artwork?.nextElementSibling).toBe(intro);
    expect(facts?.parentElement).toBe(intro);
    expect(actions?.parentElement).toBe(intro);
    expect(within(socialRow!).getByLabelText("No ratings yet")).toBeVisible();
    expect(
      socialRow!.compareDocumentPosition(actionStrip!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      header!.compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(body).toBeVisible();
    expect(ingredients).toBeVisible();
    expect(instructions).toBeVisible();
    expect(
      ingredients!.compareDocumentPosition(instructions!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(facts!).getByLabelText("Total time")).toBeVisible();
    expect(within(facts!).getByLabelText("Active time")).toBeVisible();
    expect(within(facts!).getByLabelText("Makes")).toBeVisible();
    expect(within(facts!).getByLabelText("Difficulty")).toBeVisible();
    expect(
      screen.getByText("Draft", {
        selector: ".recipe-detail__version-badge",
      }),
    ).toBeVisible();
    expect(screen.queryByText("New private recipe")).toBeNull();
    expect(screen.queryByText("Editing privately")).toBeNull();
    expect(recipe?.querySelector(".recipe-detail__parent-context")).toBeNull();
    expect(screen.getByRole("button", { name: "Finish recipe" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Review and publish" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard draft…" })).toBeNull();
    expect(recipe?.querySelector(".recipe-workspace__finish-panel")).toBeNull();
    expect(screen.getByRole("tab", { name: "Recipe" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Steps" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    ).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    const ingredient = screen.getByRole("group", { name: "Ingredient 1" });
    const ingredientSearch = within(ingredient).getByRole("combobox", {
      name: "Ingredient",
    });
    await waitFor(() => expect(ingredientSearch).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Add instruction" }));
    const instructionText = screen.getByLabelText("Instruction");
    await waitFor(() => expect(instructionText).toHaveFocus());
    expect(instructionText).toHaveAttribute("rows", "1");

    const instruction = screen.getByRole("group", { name: "Step 1" });
    for (const name of [
      "Move step 1 up",
      "Move step 1 down",
      "Remove step 1",
    ]) {
      expect(within(instruction).getByRole("button", { name })).toHaveClass(
        "recipe-workspace__ingredient-icon",
      );
    }
    expect(screen.getByRole("button", { name: "Add instruction" })).toHaveClass(
      "recipe-workspace__add-row",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Cooking breakdown" }));
    expect(screen.getByRole("tab", { name: "Steps" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    ).toHaveAttribute("aria-selected", "true");

    const addDetail = screen.getByRole("button", {
      name: "Add cooking detail to Step 1",
    });
    expect(addDetail).toHaveClass("cooking-details__add");
    fireEvent.click(addDetail);

    const detailSummary = screen.getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
    });
    expect(detailSummary).toHaveAttribute("aria-expanded", "true");
    expect(detailSummary).toHaveTextContent("Choose cooking detail");
    const detailDialog = screen.getByRole("dialog", {
      name: "Cooking detail 1 for Step 1",
    });
    expect(detailDialog).toBeVisible();
    await waitFor(() =>
      expect(
        within(detailDialog).getByRole("combobox", { name: "Cooking action" }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByRole("button", { name: "Move cooking detail 1 up" }),
    ).toHaveClass("recipe-workspace__ingredient-icon");
    expect(
      screen.getByRole("button", { name: "Move cooking detail 1 down" }),
    ).toHaveClass("recipe-workspace__ingredient-icon");
    expect(
      screen.getByRole("button", { name: "Remove cooking detail 1" }),
    ).toHaveClass("recipe-workspace__ingredient-icon");

    fireEvent.click(within(detailDialog).getByRole("button", { name: "Done" }));
    expect(
      screen.queryByRole("dialog", { name: "Cooking detail 1 for Step 1" }),
    ).toBeNull();

    fireEvent.click(
      within(ingredient).getByRole("button", {
        name: "Ingredient 1 options",
      }),
    );
    fireEvent.click(
      within(ingredient).getByRole("menuitem", {
        name: "Delete ingredient",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add ingredient" }),
      ).toHaveFocus(),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Steps" }));
    const instructionAfterBreakdown = screen.getByRole("group", {
      name: "Step 1",
    });
    fireEvent.click(
      within(instructionAfterBreakdown).getByRole("button", {
        name: "Remove step 1",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add instruction" }),
      ).toHaveFocus(),
    );
  });

  it("warns before removing an ingredient that is linked to a cooking detail", async () => {
    mocks.fetchRecipeDraft.mockResolvedValue(detailWithBoundCookingAction);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor();

    const ingredient = await screen.findByRole("group", {
      name: "Ingredient 1",
    });
    fireEvent.click(screen.getByRole("tab", { name: "Cooking breakdown" }));
    const detailSummary = screen.getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
    });
    expect(detailSummary).toHaveTextContent("Stir");
    expect(detailSummary).toHaveTextContent("Tomato");
    fireEvent.click(
      within(ingredient).getByRole("button", {
        name: "Ingredient 1 options",
      }),
    );
    const remove = within(ingredient).getByRole("menuitem", {
      name: "Delete ingredient",
    });
    fireEvent.click(remove);

    expect(confirm).toHaveBeenCalledWith(
      "Remove ingredient 1? This will also remove its link from 1 cooking action. The actions and their other details will remain.",
    );
    expect(ingredient).toBeVisible();
    expect(detailSummary).toHaveTextContent("Tomato");

    fireEvent.click(detailSummary);
    expect(
      screen.getByRole("dialog", { name: "Cooking detail 1 for Step 1" }),
    ).toBeVisible();

    confirm.mockReturnValue(true);
    fireEvent.click(
      within(ingredient).getByRole("button", {
        name: "Ingredient 1 options",
      }),
    );
    fireEvent.click(
      within(ingredient).getByRole("menuitem", {
        name: "Delete ingredient",
      }),
    );

    expect(screen.queryByRole("group", { name: "Ingredient 1" })).toBeNull();
    expect(detailSummary).not.toHaveTextContent("Tomato");
  });

  it("clears a stale save error when a controlled section changes", async () => {
    mocks.updateRecipeDraft.mockRejectedValue(
      new RecipeDraftApiError(
        "The draft has a newer saved revision.",
        409,
        "recipe_draft_revision_conflict",
      ),
    );
    renderEditor();

    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Conflicted soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "changed in another tab",
    );

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Keep editing locally." },
    });

    expect(
      screen.queryByText(
        "This draft changed in another tab. Your unsaved version is still here.",
      ),
    ).toBeNull();
    expect(screen.getByLabelText("Description")).toHaveValue(
      "Keep editing locally.",
    );
  });

  it("replaces local work only after reload is confirmed", async () => {
    mocks.fetchRecipeDraft.mockResolvedValueOnce(detail).mockResolvedValueOnce({
      ...detail,
      revision: 4,
      title: "Latest saved soup",
      updated_at: "2026-08-25T12:01:00Z",
    });
    mocks.updateRecipeDraft.mockRejectedValue(
      new RecipeDraftApiError(
        "The draft has a newer saved revision.",
        409,
        "recipe_draft_revision_conflict",
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEditor();

    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Unsaved soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Reload saved version" }),
    );

    await waitFor(() => expect(title).toHaveValue("Latest saved soup"));
    expect(screen.getByText("Loaded the latest saved version.")).toHaveClass(
      "visually-hidden",
    );
    expect(screen.getByRole("button", { name: "Draft saved" })).toBeDisabled();
  });

  it("does not replace edits made while a confirmed reload is pending", async () => {
    const reload = deferred<RecipeDraftDetail>();
    mocks.fetchRecipeDraft
      .mockResolvedValueOnce(detail)
      .mockReturnValueOnce(reload.promise);
    mocks.updateRecipeDraft.mockRejectedValue(
      new RecipeDraftApiError(
        "The draft has a newer saved revision.",
        409,
        "recipe_draft_revision_conflict",
      ),
    );
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderEditor();

    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "First local soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Reload saved version" }),
    );
    await waitFor(() =>
      expect(mocks.fetchRecipeDraft).toHaveBeenCalledTimes(2),
    );
    const reloading = screen.getByRole("button", {
      name: "Reloading saved version…",
    });
    expect(reloading).toBeDisabled();
    expect(reloading).toHaveAttribute("aria-busy", "true");

    fireEvent.change(title, { target: { value: "Newer local soup" } });
    reload.resolve({
      ...detail,
      revision: 4,
      title: "Latest saved soup",
      updated_at: "2026-08-25T12:01:00Z",
    });

    await waitFor(() => expect(title).toHaveValue("Newer local soup"));
    expect(screen.getByText("You have unsaved changes.")).toHaveClass(
      "visually-hidden",
    );
    expect(screen.queryByText("Loaded the latest saved version.")).toBeNull();
  });

  it("offers the persistent publication flow for a source-backed fork draft", async () => {
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const sourceRecipe = publicSourceRecipe(sourceId);
    mocks.fetchRecipeDraft.mockResolvedValue({
      ...detail,
      source_version_id: sourceId,
      title: "My tomato soup",
    });
    renderEditor(undefined, undefined, sourceRecipe);

    expect(
      await screen.findByText("Draft", {
        selector: ".recipe-detail__version-badge",
      }),
    ).toBeVisible();
    expect(screen.queryByText("New private recipe")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish draft" })).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        name: "Ready to share your version?",
      }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard draft…" })).toBeNull();
    const sourceLink = screen.getByRole("link", {
      name: "Public tomato soup",
    });
    expect(sourceLink).toHaveAttribute("href", `/recipes/${sourceId}`);
    const parentContext = sourceLink.closest<HTMLElement>(
      ".recipe-detail__parent-context",
    );
    expect(parentContext).not.toBeNull();
    expect(parentContext).toHaveTextContent(
      "Based on Public tomato soup by Source Cook",
    );
    expect(
      within(parentContext!).getByRole("link", { name: "Source Cook" }),
    ).toHaveAttribute("href", "/cooks/source-cook");
    const titleHeading = screen.getByLabelText("Title").closest("h1");
    const descriptionField = screen
      .getByLabelText("Description")
      .closest(".recipe-workspace__description-field");
    expect(
      titleHeading!.compareDocumentPosition(parentContext!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      parentContext!.compareDocumentPosition(descriptionField!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("Editing privately")).toBeNull();
    expect(screen.getByRole("link", { name: "Return" })).toHaveAttribute(
      "href",
      `/recipes/${sourceId}`,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Family" }));
    const draftPreview = screen.getByLabelText(
      "Selected current draft: My tomato soup",
    );
    expect(draftPreview).toHaveTextContent("Selected");
    expect(draftPreview).toHaveTextContent("Would become a version");
    expect(within(draftPreview).queryByRole("link")).toBeNull();
    expect(
      screen.queryByText(/will join that recipe family after you publish it/i),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Publish draft" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Ready to share your version?",
    });
    expect(within(dialog).getByText("Publish version")).toBeVisible();
    expect(dialog).toHaveTextContent(
      "Your version will be public, credited to you, and stay linked to the recipe you started from.",
    );
    expect(dialog).toHaveTextContent(
      "Based on Public tomato soup · the source recipe will not change.",
    );
    expect(
      within(dialog).getByRole("button", {
        name: "Review and publish version",
      }),
    ).toBeDisabled();
    expect(
      within(dialog).queryByRole("button", { name: "Discard draft…" }),
    ).toBeNull();
    expect(screen.queryByText(/belongs to RCP-28/i)).toBeNull();
  });

  it("waits for a reopened draft's source name before opening publication", async () => {
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const sourceRecipe = publicSourceRecipe(sourceId, "Resolved source recipe");
    const sourceResponse = deferred<{
      json: () => Promise<RecipeDetail>;
      ok: boolean;
    }>();
    const familyFetch = vi
      .fn()
      .mockImplementationOnce(() => sourceResponse.promise)
      .mockResolvedValueOnce({
        json: async () => ({ items: [] }),
        ok: true,
      });
    vi.stubGlobal("fetch", familyFetch);

    renderEditor({
      ...detail,
      source_version_id: sourceId,
      title: "Reopened private version",
    });

    const publish = screen.getByRole("button", {
      name: "Loading source recipe…",
    });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAttribute("aria-busy", "true");
    const pendingSourceLink = screen.getByRole("link", {
      name: "Source recipe",
    });
    expect(pendingSourceLink).toHaveAttribute("href", `/recipes/${sourceId}`);
    expect(
      pendingSourceLink.closest(".recipe-detail__parent-context"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Family" }));
    expect(screen.getByText("Loading recipe family…")).toHaveAttribute(
      "role",
      "status",
    );

    sourceResponse.resolve({
      json: async () => sourceRecipe,
      ok: true,
    });

    await waitFor(() => expect(publish).toBeEnabled());
    expect(publish).toHaveAttribute("aria-busy", "false");
    fireEvent.click(publish);

    const dialog = await screen.findByRole("dialog", {
      name: "Ready to share your version?",
    });
    expect(dialog).toHaveTextContent(
      "Based on Resolved source recipe · the source recipe will not change.",
    );
  });

  it("uses an honest source fallback if a reopened draft's source is unavailable", async () => {
    const sourceId = "22222222-2222-4222-8222-222222222222";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ json: async () => ({}), ok: false }),
    );

    renderEditor({
      ...detail,
      source_version_id: sourceId,
      title: "Reopened private version",
    });

    const publish = await screen.findByRole("button", {
      name: "Publish draft",
    });
    expect(publish).toBeEnabled();
    expect(
      screen
        .getByRole("link", { name: "Source recipe unavailable" })
        .closest(".recipe-detail__parent-context"),
    ).not.toBeNull();
    fireEvent.click(publish);

    const dialog = await screen.findByRole("dialog", {
      name: "Ready to share your version?",
    });
    expect(dialog).toHaveTextContent(
      "Based on Source recipe unavailable · the source recipe will not change.",
    );
  });

  it("loads the normal public family tree when a saved version draft is reopened", async () => {
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const sourceRecipe = publicSourceRecipe(sourceId, "Saved source recipe");
    mocks.fetchRecipeDraft.mockResolvedValue({
      ...detail,
      source_version_id: sourceId,
      title: "Resumed private version",
    });
    const familyFetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => sourceRecipe,
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ items: [] }),
        ok: true,
      });
    vi.stubGlobal("fetch", familyFetch);

    renderEditor();

    await waitFor(() => expect(familyFetch).toHaveBeenCalledTimes(2));
    const sourceLink = screen
      .getAllByRole("link", { name: "Saved source recipe" })
      .find((link) => link.closest(".recipe-detail__parent-context"));
    expect(sourceLink).toHaveAttribute("href", `/recipes/${sourceId}`);
    expect(familyFetch.mock.calls[0]?.[0]).toBe(`/api/recipes/${sourceId}`);
    expect(familyFetch.mock.calls[1]?.[0]).toContain(
      "/api/recipes?lineage_id=33333333-3333-4333-8333-333333333333",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Family" }));
    expect(
      screen.getByLabelText(
        "Selected current draft: Resumed private version",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/will join that recipe family after you publish it/i),
    ).toBeNull();
  });
});
