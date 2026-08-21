import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("leads visitors into the versioned recipe catalog", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: /a good recipe is only the beginning/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /browse the catalog/i })).toHaveAttribute(
      "href",
      "/recipes",
    );
    expect(screen.getByText(/make recipe evolution understandable/i)).toBeInTheDocument();
    expect(screen.getByText(/personalization comes after/i)).toBeInTheDocument();
  });
});
