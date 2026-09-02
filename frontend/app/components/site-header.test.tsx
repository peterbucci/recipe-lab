import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AUTH_SESSION_EXPIRED_EVENT } from "../../lib/auth-api";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { SiteHeader } from "./site-header";
import { AuthSessionProvider } from "./auth-session-provider";

describe("SiteHeader", () => {
  it("offers search and sign-in without showing creation controls to guests", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <SiteHeader />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("link", { name: /recipe lab home/i })).toHaveAttribute(
      "href",
      "/",
    );
    expect(screen.getByText("Try it. Change it. Make it yours.")).toHaveClass(
      "site-header__tagline",
    );
    expect(
      screen.queryByRole("navigation", { name: /primary navigation/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /create recipe/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/sign-in",
    );

    const mobileNavigation = screen.getByRole("navigation", {
      name: /mobile navigation/i,
    });
    expect(within(mobileNavigation).getByRole("link", { name: "Home" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(
      within(mobileNavigation).getByRole("link", { name: "Explore recipes" }),
    ).toHaveAttribute("href", "/recipes");
    expect(
      within(mobileNavigation).queryByRole("link", { name: "Create recipe" }),
    ).not.toBeInTheDocument();
    expect(mobileNavigation).not.toHaveClass("mobile-nav--with-create");
    expect(
      within(mobileNavigation).getByRole("link", { name: "My recipes" }),
    ).toHaveAttribute("href", "/account/recipes?view=drafts");
    expect(within(mobileNavigation).queryByRole("link", { name: /how it works/i })).toBeNull();

    const search = screen.getByRole("search", { name: "Site recipe search" });
    expect(search).toHaveAttribute("action", "/recipes");
    expect(within(search).getByRole("searchbox", { name: "Search recipes" })).toHaveAttribute(
      "name",
      "q",
    );
    expect(
      within(search).getByRole("button", { name: "Search recipes from the header" }),
    ).toHaveAttribute("type", "submit");
  });

  it("shows desktop and mobile creation controls to authenticated members", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        <SiteHeader />
      </AuthSessionProvider>,
    );

    const navigation = screen.getByRole("navigation", { name: /primary navigation/i });
    expect(within(navigation).getByRole("link", { name: "Create recipe" })).toHaveAttribute(
      "href",
      "/recipes/new",
    );
    const mobileNavigation = screen.getByRole("navigation", {
      name: /mobile navigation/i,
    });
    expect(
      within(mobileNavigation).getByRole("link", { name: "Create recipe" }),
    ).toHaveAttribute("href", "/recipes/new");
    expect(mobileNavigation).toHaveClass("mobile-nav--with-create");
  });

  it("keeps creation hidden until account setup is complete", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "onboarding_required",
          user: { id: "cook-id", display_name: "Alice Cook", handle: null },
        }}
      >
        <SiteHeader />
      </AuthSessionProvider>,
    );

    expect(screen.queryByRole("link", { name: "Create recipe" })).not.toBeInTheDocument();
  });

  it("removes creation controls when an authenticated session expires", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        <SiteHeader />
      </AuthSessionProvider>,
    );

    expect(screen.getAllByRole("link", { name: "Create recipe" })).toHaveLength(2);

    fireEvent(window, new Event(AUTH_SESSION_EXPIRED_EVENT));

    expect(screen.queryByRole("link", { name: "Create recipe" })).not.toBeInTheDocument();
  });
});
