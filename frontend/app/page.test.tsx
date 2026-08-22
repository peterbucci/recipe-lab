import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("leads visitors into the cooking-first recipe catalog", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", {
        name: /cook a recipe\. make it yours\. keep what worked/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /explore recipes/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
    expect(screen.getByRole("link", { name: /see how it works/i })).toHaveAttribute(
      "href",
      "#how-it-works",
    );
    expect(screen.getByRole("heading", { name: /make a variation/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /compare what changed/i })).toBeInTheDocument();
  });
});
