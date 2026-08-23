import { render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("link", { name: /^how it works$/i })).toHaveAttribute(
      "href",
      "#how-it-works",
    );
    expect(screen.getByRole("heading", { name: /make it yours/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /compare versions/i })).toBeInTheDocument();
    expect(screen.queryByText(/cook\. change\. learn/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/cooking notebook/i)).not.toBeInTheDocument();
  });
});
