import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "../../lib/auth-api";
import { deferred } from "../../tests/support/deferred";
import {
  cleanupRecipeDraftEditorMocks,
  detail,
  DRAFT_ID,
  renderEditor,
  resetRecipeDraftEditorMocks,
} from "./recipe-draft-editor-test-support";
afterEach(cleanupRecipeDraftEditorMocks);

describe("RecipeDraftEditor", () => {
  beforeEach(resetRecipeDraftEditorMocks);
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
});

