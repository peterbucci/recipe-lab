import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SiteFooter } from "./site-footer";

describe("SiteFooter", () => {
  it("identifies Recipe Lab and links only to reviewed existing destinations", () => {
    const { container } = render(<SiteFooter />);

    const footer = screen.getByRole("contentinfo");
    expect(
      within(footer).getByRole("link", { name: "Recipe Lab home" }),
    ).toHaveAttribute("href", "/");
    expect(
      container.querySelector(".site-footer__home .brand__mark svg"),
    ).toBeInTheDocument();
    expect(
      within(footer).getByText("Try it. Change it. Make it yours."),
    ).toBeVisible();
    expect(within(footer).getByText("© 2026 Recipe Lab.")).toBeVisible();

    const navigation = within(footer).getByRole("navigation", {
      name: "Footer navigation",
    });
    expect(within(navigation).getByRole("heading", { name: "Explore" })).toBeVisible();
    expect(within(navigation).getByRole("heading", { name: "Support" })).toBeVisible();
    expect(within(navigation).getByRole("heading", { name: "About" })).toBeVisible();
    expect(
      within(navigation).getByRole("link", { name: "Recipes" }),
    ).toHaveAttribute("href", "/recipes");
    expect(
      within(navigation).getByRole("link", { name: "Community rules" }),
    ).toHaveAttribute("href", "/community-rules");
    expect(within(navigation).getAllByRole("link")).toHaveLength(2);
  });

  it("presents future destinations as visibly inactive text, not broken links", () => {
    render(<SiteFooter />);

    const navigation = screen.getByRole("navigation", {
      name: "Footer navigation",
    });
    for (const destination of [
      "About Recipe Lab",
      "Categories",
      "Community",
      "Help",
      "How it works",
      "Terms",
      "Privacy",
    ]) {
      const inactiveDestination = within(navigation).getByText(destination, {
        exact: true,
      });
      expect(inactiveDestination).toHaveAttribute("aria-disabled", "true");
      expect(inactiveDestination).toHaveAccessibleName(
        `${destination}, coming soon`,
      );
      expect(inactiveDestination.closest("a")).toBeNull();
    }
  });
});
