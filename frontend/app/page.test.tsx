import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./components/home-public-discovery", () => ({
  HomePublicDiscovery: () => (
    <section>
      <h2>Featured recipes</h2>
    </section>
  ),
  HowRecipeLabWorks: () => (
    <section id="how-it-works">
      <h2>How Recipe Lab works</h2>
    </section>
  ),
}));

import { AuthSessionProvider } from "./components/auth-session-provider";
import HomePage from "./page";

describe("HomePage", () => {
  it("explains how Recipe Lab keeps changed recipes connected", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <HomePage />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", {
        name: /recipes change\. recipe lab keeps track/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /explore recipes/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
    const search = screen.getByRole("search", {
      name: "Search recipes from the home page",
    });
    expect(search).toHaveAttribute("action", "/recipes");
    expect(search).toHaveAttribute("method", "get");
    expect(within(search).getByLabelText("Search by recipe name")).toHaveAttribute(
      "name",
      "q",
    );
    expect(within(search).getByRole("button", { name: "Search" })).toHaveAttribute(
      "type",
      "submit",
    );
    expect(screen.queryByRole("link", { name: /^how it works$/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/recipe lab summary/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "How Recipe Lab works" })).toBeInTheDocument();
    expect(screen.queryByText(/cook\. change\. learn/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cooking notebook/i)).not.toBeInTheDocument();
  });
});
