import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RecipeModerationApiError } from "../../lib/recipe-moderation-api";
import {
  MODERATOR_ID,
  NOW,
  RECIPE_ID,
  SECOND_RECIPE_ID,
  moderationDetail,
  moderationSummary as summary,
  secondModerationSummary as secondSummary,
} from "../../tests/support/recipe-moderation";
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

const detail = moderationDetail();

function renderAuthorizedWorkspace() {
  return render(
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
}

function openDisclosure(label: string): HTMLDetailsElement {
  const labelElement = screen.getByText(label, { exact: true });
  const disclosure = labelElement.closest("details");
  expect(disclosure).not.toBeNull();
  fireEvent.click(labelElement);
  expect(disclosure).toHaveAttribute("open");
  return disclosure as HTMLDetailsElement;
}

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
  it("uses the shared section loader while the moderation queue resolves", () => {
    mocks.browse.mockReturnValue(new Promise(() => undefined));
    renderAuthorizedWorkspace();

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading recipe-report cases…");
    expect(status.closest(".section-loading--rows")).not.toBeNull();
  });

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

    expect(screen.getByRole("main")).toHaveClass(
      "staff-state-page",
      "staff-state-page--moderation",
      "staff-state-page--authorization",
    );
    expect(screen.getByRole("alert")).toHaveClass("staff-state-panel");
    expect(screen.getByRole("heading", { name: "We couldn’t find that page." })).toBeVisible();
    expect(screen.queryByText("Page unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText(/moderator/i)).not.toBeInTheDocument();
    expect(mocks.browse).not.toHaveBeenCalled();
  });

  it("uses the shared full-width empty state when the open queue has no cases", async () => {
    mocks.browse.mockResolvedValue({
      items: [],
      page: 1,
      page_size: 20,
      total: 0,
      total_pages: 0,
    });

    renderAuthorizedWorkspace();

    const emptyHeading = await screen.findByRole("heading", {
      level: 3,
      name: "There are no open recipe-report cases.",
    });
    const emptyState = emptyHeading.closest("section");
    const openHeader = screen
      .getByRole("heading", { level: 2, name: "Open cases" })
      .closest("header");

    expect(emptyState).not.toBeNull();
    expect(within(emptyState!).getByText("Nothing here yet")).toBeVisible();
    expect(
      within(emptyState!).getByText(
        "New reports will appear here when they need moderator review.",
      ),
    ).toBeVisible();
    expect(openHeader).toHaveTextContent("0 cases");
    expect(screen.queryByRole("searchbox", { name: "Search these cases" })).toBeNull();
    expect(mocks.detail).not.toHaveBeenCalled();

    fireEvent.click(
      within(emptyState!).getByRole("button", { name: "Refresh cases" }),
    );
    await waitFor(() => expect(mocks.browse).toHaveBeenCalledTimes(2));
    expect(mocks.detail).not.toHaveBeenCalled();
  });

  it("shows de-identified evidence and records a private moderator action", async () => {
    renderAuthorizedWorkspace();

    const detailHeading = await screen.findByRole("heading", {
      name: "Reported soup",
      level: 2,
    });
    expect(detailHeading).toBeVisible();
    expect(detailHeading.closest("main")).toHaveClass(
      "staff-workspace",
      "staff-workspace--moderation",
      "moderation-workspace",
    );
    expect(
      screen.getByRole("heading", { name: "Recipe reports", level: 1 }).closest("header"),
    ).toHaveClass("staff-workspace__header", "moderation-workspace__header");
    expect(screen.queryByText("Moderator workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Filter moderation cases" })).toHaveClass(
      "staff-workspace__filters",
    );
    const openHeader = document.querySelector(
      ".staff-workspace--moderation .workspace-panel-header",
    );
    expect(openHeader).toHaveTextContent("Open cases");
    expect(openHeader).toHaveTextContent("Cases waiting for a moderation decision.");
    expect(openHeader).toHaveTextContent("1 case");
    const queueList = screen.getByRole("list", { name: "Open cases" });
    expect(queueList).toHaveClass("staff-workspace__queue-list");
    expect(queueList.closest("section")).toHaveClass("staff-workspace__queue");
    expect(detailHeading.closest(".moderation-detail")).toHaveClass("staff-workspace__detail");
    expect(detailHeading.closest(".moderation-workspace__layout")).toHaveClass(
      "staff-workspace__layout",
    );
    expect(screen.getByText("2 reporters")).toBeVisible();
    const evidence = screen.getByRole("list", { name: "De-identified reports" });
    expect(evidence).not.toBeNull();
    expect(within(evidence).getByText("Repeated affiliate links")).toBeVisible();
    expect(within(evidence).queryByText(/reporter id|email/i)).not.toBeInTheDocument();
    const auditDisclosure = openDisclosure("Private audit history");
    expect(within(auditDisclosure).getByText("Previous private note")).toBeVisible();
    expect(screen.getByRole("link", { name: "Community rules" })).toHaveClass(
      "staff-workspace__resource-link",
    );
    expect(screen.queryByText("Catalog curation")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open public recipe" })).toHaveAttribute(
      "href",
      `/recipes/${RECIPE_ID}`,
    );

    const noteDisclosure = openDisclosure("Private moderator note");
    fireEvent.change(within(noteDisclosure).getByLabelText("Private note (optional)"), {
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

  it("keeps a private note and retry identity through a stale moderation decision", async () => {
    mocks.moderate
      .mockRejectedValueOnce(
        new RecipeModerationApiError(
          "This moderation case changed before the action completed.",
          409,
          "recipe_moderation_conflict",
        ),
      )
      .mockResolvedValueOnce({
        recipe_version_id: RECIPE_ID,
        action: "hide",
        changed: true,
        case_status: "open",
        visibility_state: "moderation_hidden",
        acted_at: NOW,
      });
    renderAuthorizedWorkspace();

    await screen.findByRole("heading", { name: "Reported soup", level: 2 });
    const noteDisclosure = openDisclosure("Private moderator note");
    const note = within(noteDisclosure).getByLabelText("Private note (optional)");
    fireEvent.change(note, { target: { value: "Keep this private note for retry." } });
    fireEvent.click(screen.getByRole("button", { name: "Hide recipe" }));

    const staleAlert = await screen.findByRole("alert");
    expect(staleAlert).toHaveClass("staff-workspace__notice", "staff-workspace__notice--error");
    expect(staleAlert).toHaveTextContent(/case changed.*private note is still here/i);
    expect(note).toHaveValue("Keep this private note for retry.");
    expect(mocks.key).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Reload case" }));
    await waitFor(() => expect(mocks.detail).toHaveBeenCalledTimes(2));
    expect(note).toHaveValue("Keep this private note for retry.");

    fireEvent.click(screen.getByRole("button", { name: "Hide recipe" }));
    await waitFor(() => expect(mocks.moderate).toHaveBeenCalledTimes(2));
    expect(mocks.moderate).toHaveBeenNthCalledWith(
      1,
      RECIPE_ID,
      "hide",
      "Keep this private note for retry.",
      "moderation-key",
    );
    expect(mocks.moderate).toHaveBeenNthCalledWith(
      2,
      RECIPE_ID,
      "hide",
      "Keep this private note for retry.",
      "moderation-key",
    );
    expect(mocks.key).toHaveBeenCalledTimes(1);
  });

  it("filters the current queue locally without hiding workspace controls", async () => {
    mocks.browse.mockResolvedValue({
      items: [summary, secondSummary],
      page: 1,
      page_size: 20,
      total: 2,
      total_pages: 1,
    });
    mocks.detail.mockImplementation((recipeId: string) =>
      Promise.resolve(
        recipeId === SECOND_RECIPE_ID
          ? {
              ...detail,
              ...secondSummary,
              reason_counts: detail.reason_counts,
              reports: detail.reports,
              history: detail.history,
            }
          : detail,
      ),
    );
    renderAuthorizedWorkspace();

    await screen.findByRole("heading", { name: "Reported soup", level: 2 });
    const search = screen.getByRole("searchbox", { name: "Search these cases" });
    expect(screen.getByRole("button", { name: /Reported soup/ })).toHaveAttribute(
      "aria-current",
      "true",
    );

    fireEvent.change(search, { target: { value: "Noodle Cook" } });
    expect(screen.queryByRole("button", { name: /Reported soup/ })).not.toBeInTheDocument();
    const secondCase = screen.getByRole("button", { name: /Flagged noodles/ });
    expect(secondCase).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("heading", { name: "No case selected", level: 2 })).toBeVisible();

    fireEvent.click(secondCase);
    expect(await screen.findByRole("heading", { name: "Flagged noodles", level: 2 })).toBeVisible();
    expect(secondCase).toHaveAttribute("aria-current", "true");
    expect(mocks.detail).toHaveBeenCalledWith(SECOND_RECIPE_ID, expect.any(AbortSignal));

    fireEvent.change(search, { target: { value: "not in the queue" } });
    expect(screen.getByText("No cases match your search on this page.")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "Search these cases" })).toBeVisible();
    expect(screen.getByRole("group", { name: "Filter moderation cases" })).toBeVisible();
    expect(screen.getByRole("button", { name: /Open/ })).toBeVisible();
    expect(screen.getByRole("button", { name: /Resolved/ })).toBeVisible();
  });

  it("marks the active status tab and gives its count an accessible name", async () => {
    const resolvedSummary = {
      ...summary,
      status: "resolved" as const,
      resolved_at: NOW,
    };
    mocks.browse.mockImplementation(({ status }: { status: "open" | "resolved" }) =>
      Promise.resolve({
        items: status === "open" ? [summary, secondSummary] : [resolvedSummary],
        page: 1,
        page_size: 20,
        total: status === "open" ? 2 : 1,
        total_pages: 1,
      }),
    );
    renderAuthorizedWorkspace();

    const openTab = await screen.findByRole("button", { name: /^Open\s*2$/ });
    const resolvedTab = screen.getByRole("button", { name: "Resolved" });
    expect(openTab).toHaveAttribute("aria-pressed", "true");
    expect(resolvedTab).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(resolvedTab);
    const activeResolvedTab = await screen.findByRole("button", {
      name: /^Resolved\s*1$/,
    });
    expect(activeResolvedTab).toHaveAttribute("aria-pressed", "true");
    const resolvedHeader = document.querySelector(
      ".staff-workspace--moderation .workspace-panel-header",
    );
    expect(resolvedHeader).toHaveTextContent("Resolved cases");
    expect(resolvedHeader).toHaveTextContent(
      "Cases with a completed moderation decision.",
    );
    expect(resolvedHeader).toHaveTextContent("1 case");
    expect(screen.getByRole("button", { name: "Open" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(mocks.browse).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "resolved", page: 1 }),
    );
  });

  it("offers only valid actions when a resolved recipe is hidden", async () => {
    mocks.detail.mockResolvedValue({
      ...detail,
      status: "resolved",
      visibility_state: "moderation_hidden",
      resolved_at: NOW,
    });
    renderAuthorizedWorkspace();

    await screen.findByRole("heading", { name: "Reported soup", level: 2 });
    expect(screen.queryByRole("link", { name: "Open public recipe" })).not.toBeInTheDocument();
    expect(screen.getByText("Not publicly available")).toBeVisible();
    expect(screen.getByRole("button", { name: "Hide recipe" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restore recipe" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Resolve case" })).toBeDisabled();
  });
});
