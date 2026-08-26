import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "../../lib/auth-api";
import type { RecipeDraftDetail } from "../../lib/recipe-draft-api";
import { RecipeDraftApiError } from "../../lib/recipe-draft-api";
import { AuthSessionProvider } from "./auth-session-provider";
import { NavigationBlockerProvider } from "./navigation-blocker-provider";
import { RecipeDraftEditor } from "./recipe-draft-editor";

const mocks = vi.hoisted(() => ({
  fetchRecipeDraft: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  updateRecipeDraft: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: () => "draft-save-key",
}));

vi.mock("../../lib/recipe-draft-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-draft-api")>();
  return {
    ...actual,
    fetchRecipeDraft: mocks.fetchRecipeDraft,
    updateRecipeDraft: mocks.updateRecipeDraft,
  };
});

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";
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

function renderEditor() {
  render(
    <NavigationBlockerProvider>
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "member", display_name: "Member", handle: "member" },
        }}
      >
        <RecipeDraftEditor draftId={DRAFT_ID} measurementUnits={[]} actionTypes={[]} />
      </AuthSessionProvider>
    </NavigationBlockerProvider>,
  );
}

describe("RecipeDraftEditor", () => {
  beforeEach(() => {
    mocks.fetchRecipeDraft.mockReset().mockResolvedValue(detail);
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
  });

  it("keeps unsaved editor state mounted when the account session expires", async () => {
    renderEditor();
    const title = await screen.findByLabelText("Title");
    fireEvent.change(title, { target: { value: "Keep this private work" } });

    fireEvent(window, new Event(AUTH_SESSION_EXPIRED_EVENT));

    expect(screen.getByLabelText("Title")).toHaveValue("Keep this private work");
    expect(screen.getByRole("form", { name: "Private recipe draft editor" })).toBeVisible();
  });

  it("offers publication review for an original draft", async () => {
    renderEditor();
    expect(await screen.findByRole("button", { name: "Review and publish" })).toBeVisible();
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
    expect(screen.getByRole("link", { name: "exact public source version" })).toHaveAttribute(
      "href",
      `/recipes/${sourceId}`,
    );
    expect(screen.queryByText(/belongs to RCP-28/i)).toBeNull();
  });
});
