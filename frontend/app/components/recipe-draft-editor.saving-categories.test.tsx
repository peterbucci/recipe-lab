import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeDraftDetail } from "../../lib/recipe-draft-api";
import { deferred } from "../../tests/support/deferred";
import {
  category,
  CATEGORY_ID,
  cleanupRecipeDraftEditorMocks,
  detail,
  DRAFT_ID,
  getRecipeDraftEditorMocks,
  RecipeDraftApiError,
  renderEditor,
  resetRecipeDraftEditorMocks,
} from "./recipe-draft-editor-test-support";

const mocks = getRecipeDraftEditorMocks();
afterEach(cleanupRecipeDraftEditorMocks);

describe("RecipeDraftEditor", () => {
  beforeEach(resetRecipeDraftEditorMocks);
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
        expect.anything(),
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
        expect.anything(),
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
        expect.anything(),
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
      expect.anything(),
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

  it("aborts an in-flight save when the private editor unmounts", async () => {
    mocks.updateRecipeDraft.mockReturnValue(new Promise(() => undefined));
    const view = renderEditor();
    fireEvent.change(await screen.findByLabelText("Title"), {
      target: { value: "Pending save" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(mocks.updateRecipeDraft).toHaveBeenCalledOnce());

    const signal = mocks.updateRecipeDraft.mock.calls[0]?.[3] as AbortSignal;
    expect(signal.aborted).toBe(false);
    view.unmount();
    expect(signal.aborted).toBe(true);
  });
});
