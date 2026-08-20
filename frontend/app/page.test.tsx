import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import HomePage from "./page";

describe("HomePage", () => {
  it("keeps the initial product milestone focused on recipe versioning", () => {
    render(<HomePage />);

    expect(
      screen.getByRole("heading", { name: /recipes evolve\. keep the useful history/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/prove recipe versioning before adding ml/i)).toBeInTheDocument();
    expect(screen.getByText(/fork a recipe into a new variant/i)).toBeInTheDocument();
  });
});
