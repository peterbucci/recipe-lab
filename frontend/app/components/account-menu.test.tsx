import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_SESSION_EXPIRED_EVENT,
  CSRF_COOKIE_NAME,
} from "../../lib/auth-api";
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
  it("shows an account-shaped skeleton while the session resolves", () => {
    routerMocks.pathname = "/recipes";
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    const { container } = render(
      <AuthSessionProvider>
        <AccountMenu />
      </AuthSessionProvider>,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Checking account status…");
    expect(status.closest(".account-slot--loading")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelector(".account-slot__loading-avatar")).not.toBeNull();
    expect(container.querySelector(".account-slot__loading-name")).not.toBeNull();
  });

  it("lets the homepage summary own the account-check announcement", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));
    render(
      <AuthSessionProvider>
        <AccountMenu />
      </AuthSessionProvider>,
    );

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("Checking account status…")).toHaveClass(
      "visually-hidden",
    );
  });

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
    const menu = screen
      .getByText("Account setup not finished")
      .closest<HTMLElement>(".account-menu__panel");
    expect(menu).not.toBeNull();
    expect(within(menu!).getByRole("link", { name: "Finish account setup" })).toHaveAttribute(
      "href",
      "/onboarding",
    );
    expect(within(menu!).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/account/settings",
    );
    expect(within(menu!).queryByRole("link", { name: "Requests" })).toBeNull();
    expect(within(menu!).getByRole("button", { name: "Sign out" })).toBeEnabled();
  });

  it("keeps member content in My recipes and account navigation in the menu", () => {
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
    const profileLink = screen.getByRole("link", { name: "View profile" });
    expect(profileLink).toHaveAttribute("href", "/cooks/alice");
    expect(profileLink).toHaveTextContent(/^View profile$/);
    const identity = profileLink.closest<HTMLElement>(".account-menu__identity");
    expect(identity).not.toBeNull();
    expect(within(identity!).getByText("Alice Cook").closest("a")).toBeNull();
    expect(within(identity!).getByText("@alice").closest("a")).toBeNull();
    expect(
      document.querySelector(".account-menu__identity .account-menu__avatar"),
    ).toHaveTextContent("A");
    expect(screen.getByRole("link", { name: "My recipes" })).toHaveAttribute(
      "href",
      "/account/recipes?view=drafts",
    );
    expect(screen.getByRole("link", { name: "Requests" })).toHaveAttribute(
      "href",
      "/account/ingredient-requests",
    );
    expect(screen.getByRole("link", { name: "Settings" })).toHaveAttribute(
      "href",
      "/account/settings",
    );
    expect(screen.queryByRole("link", { name: "Saved recipes" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "My ingredient requests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Staff tools" })).not.toBeInTheDocument();

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
    expect(screen.getByRole("link", { name: "Staff tools" })).toHaveAttribute(
      "href",
      "/staff",
    );
    expect(screen.queryByRole("link", { name: "Review ingredient requests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review recipe reports" })).not.toBeInTheDocument();
  });

  it("uses the same Staff tools destination for moderation without combining permissions", () => {
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
    expect(screen.getByRole("link", { name: "Staff tools" })).toHaveAttribute(
      "href",
      "/staff",
    );
    expect(screen.queryByRole("link", { name: "Review ingredient requests" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Review recipe reports" })).not.toBeInTheDocument();
  });

  it("still renders only one Staff tools link for a dual-role account", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "staff-id", display_name: "Sam Staff", handle: "sam" },
          capabilities: { review_ingredient_requests: true, moderate_recipe_reports: true },
        }}
      >
        <AccountMenu />
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByLabelText("Account menu for Sam Staff"));
    expect(screen.getAllByRole("link", { name: "Staff tools" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Staff tools" })).toHaveAttribute("href", "/staff");
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

  it("closes for outside pointers and Escape without closing for interactions inside", () => {
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

    const summary = screen.getByLabelText("Account menu for Alice Cook");
    const menu = summary.closest("details");
    expect(menu).not.toBeNull();

    fireEvent.click(summary);
    fireEvent.pointerDown(screen.getByRole("link", { name: "Settings" }));
    expect(menu).toHaveAttribute("open");

    fireEvent.pointerDown(document.body);
    expect(menu).not.toHaveAttribute("open");

    fireEvent.click(summary);
    expect(menu).toHaveAttribute("open");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(menu).not.toHaveAttribute("open");
    expect(summary).toHaveFocus();
  });

  it("uses a text-only sign-out state without reserving space for a loading icon", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    let resolveLogout!: (response: Response) => void;
    const logoutRequest = new Promise<Response>((resolve) => {
      resolveLogout = resolve;
    });
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockReturnValue(logoutRequest));
    const { container } = render(
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
    const signOutButton = screen.getByRole("button", { name: "Sign out" });
    expect(signOutButton).toHaveClass("account-menu__action");
    expect(container.querySelector(".loading-spinner")).toBeNull();
    expect(container.querySelector(".loading-button__pending")).toBeNull();

    fireEvent.click(signOutButton);
    const pendingButton = await screen.findByRole("button", { name: "Signing out…" });
    expect(pendingButton).toBeDisabled();
    expect(pendingButton).toHaveAttribute("aria-busy", "true");
    expect(container.querySelector(".loading-spinner")).toBeNull();
    expect(container.querySelector(".loading-button__pending")).toBeNull();

    resolveLogout(new Response(null, { status: 204 }));
    await waitFor(() => expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible());
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

    expect(
      await screen.findByRole("alert", {
        name: "Your session expired. Your work is still here.",
      }),
    ).toHaveTextContent("Sign in in a new tab");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it.each([
    ["a blank draft", "/recipes/new"],
    [
      "an exact-source draft",
      "/recipes/11111111-1111-4111-8111-111111111111/fork",
    ],
  ])("uses same-tab sign-in recovery for %s", async (_label, pathname) => {
    routerMocks.pathname = pathname;
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        <SessionRecoveryNotice />
      </AuthSessionProvider>,
    );

    fireEvent(window, new Event(AUTH_SESSION_EXPIRED_EVENT));

    const interruption = await screen.findByRole("alert", {
      name: "Your session expired. Your work is still here.",
    });
    expect(interruption).toHaveTextContent(
      "Continue sign-in in this tab. Recipe Lab will retry the same private-draft request when you return.",
    );
    const signIn = screen.getByRole("link", { name: "Continue to sign in" });
    expect(signIn).toHaveAttribute(
      "href",
      `/sign-in?${new URLSearchParams({ return_to: pathname }).toString()}`,
    );
    expect(signIn).not.toHaveAttribute("target");
    expect(signIn).not.toHaveAttribute("rel");
    expect(screen.queryByRole("button", { name: "Check sign-in" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Keep editing for now" })).toBeNull();
    await waitFor(() => expect(interruption).toHaveFocus());
    signIn.focus();
    expect(signIn).toHaveFocus();
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
