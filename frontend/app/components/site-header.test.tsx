import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { SiteHeader } from "./site-header";
import { AuthSessionProvider } from "./auth-session-provider";

describe("SiteHeader", () => {
  it("offers real search, creation, and browsing routes in the shared shell", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <SiteHeader />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("link", { name: /recipe lab home/i })).toHaveAttribute(
      "href",
      "/",
    );
    const navigation = screen.getByRole("navigation", { name: /primary navigation/i });
    expect(within(navigation).getByRole("link", { name: "Explore recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
    expect(within(navigation).getByRole("link", { name: /how it works/i })).toHaveAttribute(
      "href",
      "/#how-it-works",
    );
    expect(within(navigation).getByRole("link", { name: /create recipe/i })).toHaveAttribute(
      "href",
      "/recipes/new",
    );
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
    expect(within(mobileNavigation).getByRole("link", { name: "Explore" })).toHaveAttribute(
      "href",
      "/recipes",
    );
    expect(within(mobileNavigation).getByRole("link", { name: "Create" })).toHaveAttribute(
      "href",
      "/recipes/new",
    );

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
});
