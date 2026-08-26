import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "./auth-session-provider";
import { RecipeModerationWorkspace } from "./recipe-moderation-workspace";

const mocks = vi.hoisted(() => ({
  browse: vi.fn(),
  detail: vi.fn(),
  moderate: vi.fn(),
  key: vi.fn(),
}));

vi.mock("../../lib/idempotency-key", () => ({ createIdempotencyKey: mocks.key }));
vi.mock("../../lib/recipe-moderation-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-moderation-api")>();
  return {
    ...actual,
    browseRecipeModerationCases: mocks.browse,
    fetchRecipeModerationCase: mocks.detail,
    moderateRecipeCase: mocks.moderate,
  };
});

const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";
const MODERATOR_ID = "44444444-4444-4444-8444-444444444444";
const NOW = "2026-08-26T12:00:00Z";

const summary = {
  recipe_version_id: RECIPE_ID,
  title: "Reported soup",
  author: { id: AUTHOR_ID, handle: "cook", display_name: "Recipe Cook" },
  status: "open" as const,
  visibility_state: "published" as const,
  reporter_count: 2,
  opened_at: NOW,
  last_reported_at: NOW,
  resolved_at: null,
};

const detail = {
  ...summary,
  reason_counts: [
    { reason: "spam" as const, count: 1 },
    { reason: "dangerous_content" as const, count: 1 },
  ],
  reports: [
    { id: REPORT_ID, reason: "spam" as const, details: "Repeated affiliate links", submitted_at: NOW },
  ],
  reports_total: 1,
  reports_truncated: false,
  history: [{
    id: 1,
    action: "restore" as const,
    previous_status: "open" as const,
    status: "open" as const,
    visibility_state: "published" as const,
    private_note: "Previous private note",
    occurred_at: NOW,
    actor: { id: MODERATOR_ID, handle: "morgan", display_name: "Morgan Moderator" },
  }],
  history_total: 1,
  history_truncated: false,
};

beforeEach(() => {
  mocks.browse.mockReset().mockResolvedValue({
    items: [summary],
    page: 1,
    page_size: 20,
    total: 1,
    total_pages: 1,
  });
  mocks.detail.mockReset().mockResolvedValue(detail);
  mocks.moderate.mockReset().mockResolvedValue({
    recipe_version_id: RECIPE_ID,
    action: "hide",
    changed: true,
    case_status: "open",
    visibility_state: "moderation_hidden",
    acted_at: NOW,
  });
  mocks.key.mockReset().mockReturnValue("moderation-key");
});

describe("RecipeModerationWorkspace", () => {
  it("does not reveal the workspace to ordinary members", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "member-id", handle: "member", display_name: "Member" },
          capabilities: { review_ingredient_requests: false, moderate_recipe_reports: false },
        }}
      >
        <RecipeModerationWorkspace />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("heading", { name: "We couldn’t find that page." })).toBeVisible();
    expect(screen.queryByText(/moderator/i)).not.toBeInTheDocument();
    expect(mocks.browse).not.toHaveBeenCalled();
  });

  it("shows de-identified evidence and records a private moderator action", async () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: MODERATOR_ID, handle: "morgan", display_name: "Morgan Moderator" },
          capabilities: { review_ingredient_requests: false, moderate_recipe_reports: true },
        }}
      >
        <RecipeModerationWorkspace />
      </AuthSessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Reported soup", level: 2 })).toBeVisible();
    expect(screen.getByText("2 reporters")).toBeVisible();
    const evidence = screen.getByRole("heading", { name: "De-identified reports" }).closest("section");
    expect(evidence).not.toBeNull();
    expect(within(evidence!).getByText("Repeated affiliate links")).toBeVisible();
    expect(within(evidence!).queryByText(/reporter id|email/i)).not.toBeInTheDocument();
    expect(screen.getByText("Previous private note")).toBeVisible();
    expect(screen.getByRole("link", { name: "Open public recipe" })).toHaveAttribute(
      "href",
      `/recipes/${RECIPE_ID}`,
    );

    fireEvent.change(screen.getByLabelText("Private note (optional)"), {
      target: { value: "  Links confirmed in recipe body.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hide recipe" }));

    await waitFor(() =>
      expect(mocks.moderate).toHaveBeenCalledWith(
        RECIPE_ID,
        "hide",
        "Links confirmed in recipe body.",
        "moderation-key",
      ),
    );
    expect(await screen.findByText(/moderation record was updated/i)).toBeVisible();
  });
});
