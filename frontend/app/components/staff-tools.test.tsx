import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../lib/auth-api";
import { AuthSessionProvider } from "./auth-session-provider";
import { StaffTools } from "./staff-tools";

function renderStaffTools(session: AuthSession) {
  return render(
    <AuthSessionProvider initialSession={session}>
      <StaffTools />
    </AuthSessionProvider>,
  );
}

function authenticatedSession(
  reviewIngredientRequests: boolean,
  moderateRecipeReports: boolean,
): AuthSession {
  return {
    status: "authenticated",
    user: { id: "staff-id", display_name: "Sam Staff", handle: "sam" },
    capabilities: {
      review_ingredient_requests: reviewIngredientRequests,
      moderate_recipe_reports: moderateRecipeReports,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("StaffTools", () => {
  it("uses the shared account gate while staff access is checked", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(
      <AuthSessionProvider>
        <StaffTools />
      </AuthSessionProvider>,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Checking staff access…");
    expect(status.closest(".auth-gate-loading")).not.toBeNull();
  });

  it("does not expose staff workspaces to an ordinary member", () => {
    renderStaffTools(authenticatedSession(false, false));

    expect(screen.getByRole("heading", { name: "Staff Tools", level: 1 })).toBeVisible();
    expect(screen.getByText("Open the staff tools available to your account.")).toBeVisible();
    expect(document.querySelector(".staff-tools__intro .eyebrow")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Back to home/i })).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "No staff tools are assigned to this account." }),
    ).toBeVisible();
    expect(screen.queryByRole("tablist", { name: "Staff tool categories" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open ingredient catalog" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open recipe reports" })).toBeNull();
  });

  it.each([
    [
      true,
      false,
      "Curator tools",
      "Open ingredient catalog",
      "/catalog/ingredient-requests",
      "Moderator tools",
      "Open recipe reports",
    ],
    [
      false,
      true,
      "Moderator tools",
      "Open recipe reports",
      "/moderation/recipes",
      "Curator tools",
      "Open ingredient catalog",
    ],
  ] as const)(
    "shows only the workspace authorized by each narrow staff role",
    (curator, moderator, tabName, linkName, href, unavailableTab, unavailableLink) => {
      renderStaffTools(authenticatedSession(curator, moderator));

      expect(screen.getByRole("heading", { name: "Staff Tools", level: 1 })).toBeVisible();
      expect(screen.getByText("Open the staff tools available to your account.")).toBeVisible();
      expect(document.querySelector(".staff-tools__intro .eyebrow")).toBeNull();
      expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
      expect(screen.getByRole("tablist", { name: "Staff tool categories" })).toHaveClass(
        "staff-tools__role-tabs",
      );
      const tab = screen.getByRole("tab", { name: tabName });
      expect(tab).toHaveAttribute("aria-selected", "true");
      expect(tab).toHaveAttribute("tabindex", "0");
      expect(screen.getByRole("tabpanel", { name: tabName })).toBeVisible();
      expect(screen.getByRole("link", { name: linkName })).toHaveAttribute("href", href);
      expect(screen.queryByRole("tab", { name: new RegExp(unavailableTab) })).toBeNull();
      expect(screen.queryByRole("link", { name: unavailableLink })).toBeNull();
    },
  );

  it("switches between independently authorized workspaces for a dual-role account", () => {
    renderStaffTools(authenticatedSession(true, true));

    expect(
      screen.queryByText(/Additional curator workspaces can be added here later/i),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(/Future moderation tools would appear in this tab/i),
    ).not.toBeInTheDocument();

    const curatorTab = screen.getByRole("tab", { name: "Curator tools" });
    const moderatorTab = screen.getByRole("tab", { name: "Moderator tools" });
    const curatorPanel = document.getElementById("staff-curator-panel");
    const moderatorPanel = document.getElementById("staff-moderator-panel");

    expect(curatorTab).toHaveAttribute("aria-selected", "true");
    expect(moderatorTab).toHaveAttribute("aria-selected", "false");
    expect(curatorPanel).toBeVisible();
    expect(moderatorPanel).not.toBeVisible();
    const curatorHeader = screen
      .getByRole("heading", { level: 2, name: "Curator tools" })
      .closest("header");
    expect(curatorHeader).toHaveClass("workspace-panel-header");
    expect(curatorHeader).toHaveTextContent(
      "Maintain trusted catalog data used by recipe editors.",
    );
    expect(curatorHeader).toHaveTextContent("Curator access");
    expect(screen.getByRole("link", { name: "Open ingredient catalog" })).toHaveAttribute(
      "href",
      "/catalog/ingredient-requests",
    );

    fireEvent.click(moderatorTab);

    expect(curatorTab).toHaveAttribute("aria-selected", "false");
    expect(moderatorTab).toHaveAttribute("aria-selected", "true");
    expect(curatorPanel).not.toBeVisible();
    expect(moderatorPanel).toBeVisible();
    const moderatorHeader = screen
      .getByRole("heading", { level: 2, name: "Moderator tools" })
      .closest("header");
    expect(moderatorHeader).toHaveClass("workspace-panel-header");
    expect(moderatorHeader).toHaveTextContent(
      "Review community reports and public-content visibility.",
    );
    expect(moderatorHeader).toHaveTextContent("Moderator access");
    expect(screen.getByRole("link", { name: "Open recipe reports" })).toHaveAttribute(
      "href",
      "/moderation/recipes",
    );
  });

  it("supports arrow, Home, and End keyboard navigation between role tabs", () => {
    renderStaffTools(authenticatedSession(true, true));

    const curatorTab = screen.getByRole("tab", { name: "Curator tools" });
    const moderatorTab = screen.getByRole("tab", { name: "Moderator tools" });
    curatorTab.focus();

    fireEvent.keyDown(curatorTab, { key: "ArrowRight" });
    expect(moderatorTab).toHaveFocus();
    expect(moderatorTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(moderatorTab, { key: "ArrowRight" });
    expect(curatorTab).toHaveFocus();
    expect(curatorTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(curatorTab, { key: "End" });
    expect(moderatorTab).toHaveFocus();
    expect(moderatorTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(moderatorTab, { key: "Home" });
    expect(curatorTab).toHaveFocus();
    expect(curatorTab).toHaveAttribute("aria-selected", "true");
  });

  it("asks an anonymous visitor to sign in without exposing either tool", () => {
    renderStaffTools({ status: "anonymous" });

    expect(screen.getByRole("heading", { name: "Sign in to open staff tools." })).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Fstaff",
    );
    expect(screen.queryByText("Ingredient catalog")).toBeNull();
    expect(screen.queryByText("Recipe reports")).toBeNull();
  });

  it("retries an unavailable account check", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthSessionProvider>
        <StaffTools />
      </AuthSessionProvider>,
    );

    expect(await screen.findByRole("heading", { name: "We couldn’t check your access." })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sign in to open staff tools." })).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
