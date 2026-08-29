import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("explains how Recipe Lab keeps changed recipes connected", () => {
    render(<HomePage />);

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
    expect(screen.getByRole("heading", { name: /choose a recipe/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /your version/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /see what changed/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/how saving a changed recipe works/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cook\. change\. learn/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cooking notebook/i)).not.toBeInTheDocument();
  });
});
