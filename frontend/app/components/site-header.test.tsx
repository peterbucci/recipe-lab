import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }),
}));

import { SiteHeader } from "./site-header";
import { AuthSessionProvider } from "./auth-session-provider";

describe("SiteHeader", () => {
  it("offers the small cooking-first navigation", () => {
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
    expect(within(navigation).getByRole("link", { name: /explore recipes/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
    expect(within(navigation).getByRole("link", { name: /how it works/i })).toHaveAttribute(
      "href",
      "/#how-it-works",
    );
    expect(within(navigation).getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });
});
