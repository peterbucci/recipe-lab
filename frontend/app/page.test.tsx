import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigationMocks = vi.hoisted(() => ({
  cookies: vi.fn(),
  redirect: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: navigationMocks.cookies,
}));

vi.mock("next/navigation", () => ({
  redirect: navigationMocks.redirect,
  useRouter: () => ({ replace: navigationMocks.replace }),
}));

vi.mock("./components/home-public-discovery", () => ({
  HomePublicDiscovery: () => (
    <section>
      <h2>Featured recipes</h2>
    </section>
  ),
}));

import { AuthSessionProvider } from "./components/auth-session-provider";
import HomePage from "./page";

describe("HomePage", () => {
  beforeEach(() => {
    navigationMocks.cookies.mockReset();
    navigationMocks.redirect.mockReset();
    navigationMocks.replace.mockReset();
  });

  it("redirects visitors without a session cookie to the recipe catalog", async () => {
    navigationMocks.cookies.mockResolvedValue({ get: () => undefined });
    navigationMocks.redirect.mockImplementation(() => {
      throw new Error("NEXT_REDIRECT");
    });

    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT");

    expect(navigationMocks.redirect).toHaveBeenCalledWith("/recipes");
  });

  it("keeps the member dashboard for an authenticated session", async () => {
    navigationMocks.cookies.mockResolvedValue({
      get: () => ({ name: "recipe_lab_session", value: "opaque-session" }),
    });

    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        {await HomePage()}
      </AuthSessionProvider>,
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Featured recipes" })).toBeInTheDocument(),
    );
    expect(navigationMocks.redirect).not.toHaveBeenCalled();
    expect(navigationMocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByText(/recipes change/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("search", { name: "Search recipes from the home page" }),
    ).not.toBeInTheDocument();
    expect(screen.getByLabelText(/alice cook’s recipe lab summary/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "How Recipe Lab works" })).not.toBeInTheDocument();
  });
});
