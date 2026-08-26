import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../lib/auth-api";
import { AccountMenu } from "./account-menu";
import {
  AuthSessionProvider,
  SessionRecoveryNotice,
} from "./auth-session-provider";

const routerMocks = vi.hoisted(() => ({
  pathname: "/",
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => routerMocks.pathname,
  useRouter: () => routerMocks,
}));

afterEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  routerMocks.pathname = "/";
  routerMocks.refresh.mockReset();
  routerMocks.replace.mockReset();
  vi.unstubAllGlobals();
});

describe("AccountMenu", () => {
  it("offers sign-in without blocking anonymous browsing", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <AccountMenu />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it("shows a keyboard-operable account menu and onboarding destination", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "onboarding_required",
          user: { id: "cook-id", display_name: "Alice Cook", handle: null },
        }}
      >
        <AccountMenu />
      </AuthSessionProvider>,
    );

    const summary = screen.getByText("Alice Cook", { selector: "summary *" }).closest("summary");
    expect(summary).not.toBeNull();
    fireEvent.click(summary!);
    const menu = screen.getByText("Account setup not finished").closest("div");
    expect(menu).not.toBeNull();
    expect(within(menu!).getByRole("link", { name: "Finish account setup" })).toHaveAttribute(
      "href",
      "/onboarding",
    );
    expect(within(menu!).getByRole("link", { name: "Account settings" })).toHaveAttribute(
      "href",
      "/account/settings",
    );
    expect(within(menu!).getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  it("shows the review workspace only to a catalog curator", () => {
    const { rerender } = render(
      <AuthSessionProvider
        key="member"
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
          capabilities: { review_ingredient_requests: false, moderate_recipe_reports: false },
        }}
      >
        <AccountMenu />
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByLabelText("Account menu for Alice Cook"));
    expect(screen.getByRole("link", { name: "Public profile" })).toHaveAttribute(
      "href",
      "/cooks/alice",
    );
    expect(screen.getByRole("link", { name: "My recipes" })).toHaveAttribute(
      "href",
      "/account/recipes",
    );
    expect(screen.getByRole("link", { name: "Saved recipes" })).toHaveAttribute(
      "href",
      "/account/saved-recipes",
    );
    expect(
      screen.getByRole("link", { name: "My ingredient requests" }),
    ).toHaveAttribute("href", "/account/ingredient-requests");
    expect(screen.getByRole("link", { name: "Account settings" })).toHaveAttribute(
      "href",
      "/account/settings",
    );
    expect(
      screen.queryByRole("link", { name: "Review ingredient requests" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review recipe reports" })).not.toBeInTheDocument();

    rerender(
      <AuthSessionProvider
        key="curator"
        initialSession={{
          status: "authenticated",
          user: { id: "curator-id", display_name: "Casey Curator", handle: "casey" },
          capabilities: { review_ingredient_requests: true, moderate_recipe_reports: false },
        }}
      >
        <AccountMenu />
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByLabelText("Account menu for Casey Curator"));
    expect(
      screen.getByRole("link", { name: "My ingredient requests" }),
    ).toHaveAttribute("href", "/account/ingredient-requests");
    expect(
      screen.getByRole("link", { name: "Review ingredient requests" }),
    ).toHaveAttribute("href", "/catalog/ingredient-requests");
    expect(screen.queryByRole("link", { name: "Review recipe reports" })).not.toBeInTheDocument();
  });

  it("shows recipe moderation independently from catalog curation", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "moderator-id", display_name: "Morgan Moderator", handle: "morgan" },
          capabilities: { review_ingredient_requests: false, moderate_recipe_reports: true },
        }}
      >
        <AccountMenu />
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByLabelText("Account menu for Morgan Moderator"));
    expect(screen.getByRole("link", { name: "Review recipe reports" })).toHaveAttribute(
      "href",
      "/moderation/recipes",
    );
    expect(screen.queryByRole("link", { name: "Review ingredient requests" })).not.toBeInTheDocument();
  });

  it("closes after a completed route change but stays open when the route does not change", () => {
    function authenticatedMenu() {
      return (
        <AuthSessionProvider
          initialSession={{
            status: "authenticated" as const,
            user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
          }}
        >
          <AccountMenu />
        </AuthSessionProvider>
      );
    }

    const { rerender } = render(authenticatedMenu());
    const summary = screen.getByLabelText("Account menu for Alice Cook");
    const menu = summary.closest("details");
    expect(menu).not.toBeNull();

    fireEvent.click(summary);
    expect(menu).toHaveAttribute("open");

    rerender(authenticatedMenu());
    expect(menu).toHaveAttribute("open");

    routerMocks.pathname = "/catalog/ingredient-requests";
    rerender(authenticatedMenu());
    expect(menu).not.toHaveAttribute("open");
  });

  it("signs out with CSRF protection and replaces the menu with sign-in", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        <AccountMenu />
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByLabelText("Account menu for Alice Cook"));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/logout",
      expect.objectContaining({
        method: "POST",
        headers: { Accept: "application/json", "X-CSRF-Token": "csrf-value" },
      }),
    );
    expect(routerMocks.replace).toHaveBeenCalledWith("/");
    expect(routerMocks.refresh).toHaveBeenCalledOnce();
  });

  it("turns an expired mutation into a global sign-in recovery notice", async () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        <SessionRecoveryNotice />
        <AccountMenu />
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByLabelText("Account menu for Alice Cook"));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert", { name: "Session expired" })).toHaveTextContent(
      "Sign in again",
    );
    expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible();
  });

  it("lets an auth-service error be retried", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthSessionProvider>
        <AccountMenu />
      </AuthSessionProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Retry account" }));

    await waitFor(() => expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
