import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "../../lib/auth-api";
import type { RecipeDraftDetail } from "../../lib/recipe-draft-api";
import { RecipeDraftApiError } from "../../lib/recipe-draft-api";
import { AuthSessionProvider, SessionRecoveryNotice } from "./auth-session-provider";
import { NavigationBlockerProvider } from "./navigation-blocker-provider";
import { RecipeDraftEditor } from "./recipe-draft-editor";

const mocks = vi.hoisted(() => ({
  discardRecipeDraft: vi.fn(),
  fetchRecipeDraft: vi.fn(),
  key: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  updateRecipeDraft: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => `/account/recipe-drafts/${DRAFT_ID}`,
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: () => mocks.key(),
}));

vi.mock("../../lib/recipe-draft-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-draft-api")>();
  return {
    ...actual,
    discardRecipeDraft: mocks.discardRecipeDraft,
    fetchRecipeDraft: mocks.fetchRecipeDraft,
    updateRecipeDraft: mocks.updateRecipeDraft,
  };
});

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
const INGREDIENT_ROW_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "33333333-3333-4333-8333-333333333333";
const detail: RecipeDraftDetail = {
  id: DRAFT_ID,
  source_version_id: null,
  status: "active",
  revision: 3,
  title: "",
  description: null,
  servings: null,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function renderEditor() {
  render(
    <NavigationBlockerProvider>
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "member", display_name: "Member", handle: "member" },
        }}
      >
        <SessionRecoveryNotice />
        <RecipeDraftEditor draftId={DRAFT_ID} measurementUnits={[]} actionTypes={[]} />
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
    mocks.discardRecipeDraft.mockReset().mockResolvedValue(undefined);
    mocks.fetchRecipeDraft.mockReset().mockResolvedValue(detail);
    mocks.key.mockReset().mockReturnValue("draft-save-key");
    mocks.updateRecipeDraft.mockReset();
    mocks.refresh.mockReset();
    mocks.replace.mockReset();
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
    fireEvent.change(title, { target: { value: "My unsaved soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(mocks.updateRecipeDraft).toHaveBeenCalledWith(
      DRAFT_ID,
      expect.objectContaining({ revision: 3, title: "My unsaved soup" }),
      "draft-save-key",
    ));
    expect(screen.getByLabelText("Title")).toHaveValue("My unsaved soup");
    expect(screen.getByRole("alert")).toHaveTextContent("changed in another tab");
    expect(screen.getByRole("button", { name: "Reload saved version" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Open saved version in a new tab" })).toHaveAttribute(
      "target",
      "_blank",
    );
    await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    fireEvent.click(screen.getByRole("button", { name: "Reload saved version" }));
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

    expect(screen.getByLabelText("Title")).toHaveValue("Keep this private work");
    expect(screen.getByRole("form", { name: "Private recipe draft editor" })).toBeVisible();
    expect(screen.getByText("You have unsaved changes.")).toBeVisible();
    const interruption = await screen.findByRole("alert", {
      name: "Your session expired. Your work is still here.",
    });
    await waitFor(() => expect(interruption).toHaveFocus());
    expect(screen.getByRole("link", { name: "Sign in in a new tab" })).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Faccount%2Frecipe-drafts%2F${DRAFT_ID}`,
    );
    expect(screen.getByRole("link", { name: "Sign in in a new tab" })).toHaveAttribute(
      "target",
      "_blank",
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep editing for now" }));
    expect(screen.getByText(/Sign-in is still required before saving/)).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue("Keep this private work");
    await waitFor(() => expect(title).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Resume sign-in" }));
    const resumed = await screen.findByRole("alert", {
      name: "Your session expired. Your work is still here.",
    });
    await waitFor(() => expect(resumed).toHaveFocus());
  });

  it("recovers the original editor after sign-in without losing unsaved values", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: "authenticated",
        user: { id: "member", display_name: "Member", handle: "member" },
      }),
    );
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
    expect(screen.getByText("You have unsaved changes.")).toBeVisible();
    await waitFor(() => expect(title).toHaveFocus());
  });

  it("keeps recovery available when sign-in is canceled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ status: "anonymous" })),
    );
    renderEditor();
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Do not discard this" } });
    fireEvent(window, new Event(AUTH_SESSION_EXPIRED_EVENT));

    fireEvent.click(await screen.findByRole("button", { name: "Check sign-in" }));

    expect(await screen.findByText("Sign-in is not complete. Your work is still here.")).toBeVisible();
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
          user: { id: "different-member", display_name: "Other Member", handle: "other" },
        }),
      ),
    );
    renderEditor();
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Alice's private unsaved work" } });
    fireEvent(window, new Event(AUTH_SESSION_EXPIRED_EVENT));

    fireEvent.click(await screen.findByRole("button", { name: "Check sign-in" }));

    expect(
      await screen.findByText(
        "A different account is signed in. Sign back in as the account that owns this work.",
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue("Alice's private unsaved work");
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

    expect(await screen.findByText("Saving your private draft…")).toBeVisible();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    save.resolve({
      ...detail,
      revision: 4,
      title: "Saved soup",
      updated_at: "2026-08-25T12:01:00Z",
    });

    expect(await screen.findByText("Draft saved privately.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Draft saved" })).toBeDisabled();
    expect(title).toHaveValue("Saved soup");
  });

  it("retries the same failed save attempt with the same idempotency key", async () => {
    mocks.key.mockReset().mockReturnValueOnce("first-save-key").mockReturnValue("unused-key");
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
      await screen.findByText("Recipe Lab could not save this draft. Your edits are still here."),
    ).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateRecipeDraft).toHaveBeenCalledTimes(2));
    expect(mocks.updateRecipeDraft.mock.calls.map((call) => call[2])).toEqual([
      "first-save-key",
      "first-save-key",
    ]);
    expect(await screen.findByText("Draft saved privately.")).toBeVisible();
  });

  it("reuses a failed save attempt after an edit is changed back", async () => {
    mocks.key.mockReset().mockReturnValueOnce("first-save-key").mockReturnValue("unused-key");
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
      await screen.findByText("Recipe Lab could not save this draft. Your edits are still here."),
    ).toBeVisible();

    fireEvent.change(title, { target: { value: "Temporary wording" } });
    fireEvent.change(title, { target: { value: "Retry soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    await waitFor(() => expect(mocks.updateRecipeDraft).toHaveBeenCalledTimes(2));
    expect(mocks.updateRecipeDraft.mock.calls.map((call) => call[2])).toEqual([
      "first-save-key",
      "first-save-key",
    ]);
    expect(await screen.findByText("Draft saved privately.")).toBeVisible();
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
      await screen.findByText("Earlier changes saved. Your newer edits are still unsaved."),
    ).toBeVisible();
    expect(title).toHaveValue("Newer local title");
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateRecipeDraft).toHaveBeenCalledTimes(2));
    expect(mocks.updateRecipeDraft).toHaveBeenLastCalledWith(
      DRAFT_ID,
      expect.objectContaining({ revision: 4, title: "Newer local title" }),
      "draft-save-key",
    );
    expect(await screen.findByText("Draft saved privately.")).toBeVisible();
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
      await screen.findByText("Recipe Lab could not save this draft. Your edits are still here."),
    ).toBeVisible();
    expect(screen.queryByText(/canonical|occurrence|99999999/i)).toBeNull();
    expect(title).toHaveValue("Newer local title");
  });

  it("offers publication review for an original draft", async () => {
    renderEditor();
    expect(await screen.findByRole("button", { name: "Review and publish" })).toBeVisible();
  });

  it("opens the affected cooking details without losing a prose-only saved draft", async () => {
    mocks.fetchRecipeDraft.mockResolvedValue({
      ...detailWithBoundCookingAction,
      instructions: detailWithBoundCookingAction.instructions.map((instruction) => ({
        ...instruction,
        actions: [],
      })),
    });
    renderEditor();

    const instruction = await screen.findByLabelText("Instruction");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /agree to the community rules/i }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /right to share it/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));

    expect(
      await screen.findByRole("heading", { name: "Your draft needs attention" }),
    ).toBeVisible();
    expect(instruction).toHaveValue("Stir in the tomato.");
    expect(
      screen.getByText(
        "Add at least one cooking detail to this step so Recipe Lab can compare similar recipes before publishing.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Add cooking details for Step 1" }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("keeps the editor sections in order and restores focus after row changes", async () => {
    renderEditor();

    const form = await screen.findByRole("form", { name: "Private recipe draft editor" });
    const sectionLabels = Array.from(form.children)
      .filter((child) => child.matches("fieldset, section"))
      .map((section) =>
        Array.from(section.children).find((child) => child.matches("legend, h2"))?.textContent,
      );
    expect(sectionLabels).toEqual([
      "Recipe details",
      "Ingredients",
      "Instructions",
      "Publish this original recipe.",
      "Discard this draft",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    const ingredient = screen.getByRole("group", { name: "Ingredient 1" });
    const ingredientSearch = within(ingredient).getByRole("combobox", {
      name: "Ingredient",
    });
    await waitFor(() => expect(ingredientSearch).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Add instruction" }));
    const instructionText = screen.getByLabelText("Instruction");
    await waitFor(() => expect(instructionText).toHaveFocus());
    const cookingDetails = screen.getByRole("button", {
      name: "Add cooking details for Step 1",
    });
    expect(
      instructionText.compareDocumentPosition(cookingDetails) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(cookingDetails).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(within(ingredient).getByRole("button", { name: /^Remove/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add ingredient" })).toHaveFocus(),
    );

    const instruction = screen.getByRole("group", { name: "Step 1" });
    fireEvent.click(within(instruction).getByRole("button", { name: /^Remove/ }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Add instruction" })).toHaveFocus(),
    );
  });

  it("warns before removing an ingredient that is linked to hidden cooking details", async () => {
    mocks.fetchRecipeDraft.mockResolvedValue(detailWithBoundCookingAction);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor();

    const ingredient = await screen.findByRole("group", { name: "Ingredient 1" });
    const remove = within(ingredient).getByRole("button", { name: "Remove ingredient 1" });
    fireEvent.click(remove);

    expect(confirm).toHaveBeenCalledWith(
      "Remove ingredient 1? This will also remove its link from 1 cooking action. The actions and their other details will remain.",
    );
    expect(ingredient).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Edit cooking details for Step 1" }),
    ).toHaveTextContent("Tomato");

    confirm.mockReturnValue(true);
    fireEvent.click(remove);

    expect(screen.queryByRole("group", { name: "Ingredient 1" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Edit cooking details for Step 1" }),
    ).not.toHaveTextContent("Tomato");
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
    expect(await screen.findByRole("alert")).toHaveTextContent("changed in another tab");

    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "Keep editing locally." },
    });

    expect(screen.queryByText("This draft changed in another tab. Your unsaved version is still here.")).toBeNull();
    expect(screen.getByLabelText("Description")).toHaveValue("Keep editing locally.");
  });

  it("replaces local work only after reload is confirmed", async () => {
    mocks.fetchRecipeDraft
      .mockResolvedValueOnce(detail)
      .mockResolvedValueOnce({
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
    fireEvent.click(await screen.findByRole("button", { name: "Reload saved version" }));

    await waitFor(() => expect(title).toHaveValue("Latest saved soup"));
    expect(screen.getByText("Loaded the latest saved version.")).toBeVisible();
    expect(screen.getByRole("button", { name: "Draft saved" })).toBeDisabled();
  });

  it("does not replace edits made while a confirmed reload is pending", async () => {
    const reload = deferred<RecipeDraftDetail>();
    mocks.fetchRecipeDraft.mockResolvedValueOnce(detail).mockReturnValueOnce(reload.promise);
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
    fireEvent.click(await screen.findByRole("button", { name: "Reload saved version" }));
    await waitFor(() => expect(mocks.fetchRecipeDraft).toHaveBeenCalledTimes(2));

    fireEvent.change(title, { target: { value: "Newer local soup" } });
    reload.resolve({
      ...detail,
      revision: 4,
      title: "Latest saved soup",
      updated_at: "2026-08-25T12:01:00Z",
    });

    await waitFor(() => expect(title).toHaveValue("Newer local soup"));
    expect(screen.getByText("You have unsaved changes.")).toBeVisible();
    expect(screen.queryByText("Loaded the latest saved version.")).toBeNull();
  });

  it("returns editor backlinks and discard success to the My recipes Drafts view", async () => {
    renderEditor();

    expect(await screen.findByRole("link", { name: "← My recipes" })).toHaveAttribute(
      "href",
      "/account/recipes?view=drafts",
    );
    expect(screen.getByRole("link", { name: "Back to drafts" })).toHaveAttribute(
      "href",
      "/account/recipes?view=drafts",
    );
    fireEvent.click(screen.getByRole("button", { name: "Discard draft…" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard permanently" }));

    await waitFor(() =>
      expect(mocks.discardRecipeDraft).toHaveBeenCalledWith(DRAFT_ID, 3, "draft-save-key"),
    );
    expect(mocks.replace).toHaveBeenCalledWith("/account/recipes?view=drafts");
  });

  it("cancels discard confirmation without deleting the draft", async () => {
    renderEditor();

    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Keep this dirty soup" } });
    fireEvent.click(screen.getByRole("button", { name: "Discard draft…" }));
    expect(screen.getByRole("button", { name: "Discard permanently" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Keep draft" }));

    expect(screen.queryByRole("button", { name: "Discard permanently" })).toBeNull();
    expect(screen.getByRole("button", { name: "Discard draft…" })).toBeVisible();
    expect(title).toHaveValue("Keep this dirty soup");
    expect(screen.getByText("You have unsaved changes.")).toBeVisible();
    expect(mocks.discardRecipeDraft).not.toHaveBeenCalled();
  });

  it("offers the persistent publication flow for a source-backed fork draft", async () => {
    const sourceId = "22222222-2222-4222-8222-222222222222";
    mocks.fetchRecipeDraft.mockResolvedValue({
      ...detail,
      source_version_id: sourceId,
    });
    renderEditor();

    expect(
      await screen.findByRole("heading", {
        name: "Publish your version without changing its source.",
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Review and publish version" })).toBeVisible();
    expect(screen.getByRole("link", { name: "the public recipe you started from" })).toHaveAttribute(
      "href",
      `/recipes/${sourceId}`,
    );
    expect(screen.queryByText(/belongs to RCP-28/i)).toBeNull();
  });
});
