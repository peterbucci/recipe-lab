import { render, screen, within } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it } from "vitest";

import { PaginationOutOfRange } from "./pagination-out-of-range";

describe("PaginationOutOfRange", () => {
  it("renders an ordinary, labelled collection state with caller-owned recovery", () => {
    render(
      <PaginationOutOfRange
        action={
          <Link href="/recipes?q=soup">Return to the first page</Link>
        }
        className="catalog-results__empty"
        description="The collection currently has 2 pages of recipes."
        headingId="catalog-page-out-of-range"
        title="That page is beyond the results."
      />,
    );

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "That page is beyond the results.",
    });
    const state = heading.closest("section");

    expect(state).not.toBeNull();
    expect(state).toHaveClass(
      "empty-state",
      "workspace-empty-state",
      "catalog-results__empty",
    );
    expect(within(state!).getByText("Page out of range")).toBeVisible();
    expect(
      within(state!).getByText("The collection currently has 2 pages of recipes."),
    ).toHaveAttribute("id", "catalog-page-out-of-range-description");
    expect(
      within(state!).getByRole("link", { name: "Return to the first page" }),
    ).toHaveAttribute("href", "/recipes?q=soup");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("supports a caller-selected heading level and eyebrow", () => {
    render(
      <PaginationOutOfRange
        action={<button type="button">Show page one</button>}
        description="This cook currently has one page of recipes."
        eyebrow="Older recipes"
        headingId="cook-page-out-of-range"
        headingLevel={3}
        title="That page is beyond this cook’s recipes."
      />,
    );

    expect(
      screen.getByRole("heading", {
        level: 3,
        name: "That page is beyond this cook’s recipes.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Older recipes")).toBeVisible();
  });
});
