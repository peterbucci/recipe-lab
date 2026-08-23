import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("offers the small cooking-first navigation", () => {
    render(<SiteHeader />);

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
  });
});
