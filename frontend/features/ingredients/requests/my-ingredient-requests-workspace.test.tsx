import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MyIngredientRequestsWorkspace } from "./my-ingredient-requests-workspace";

vi.mock("./member-ingredient-request-history", () => ({
  MemberIngredientRequestHistory: () => (
    <section aria-label="My ingredient requests">
      Member request history
    </section>
  ),
}));

describe("MyIngredientRequestsWorkspace", () => {
  it("shows authenticated members their view-only request history", () => {
    render(<MyIngredientRequestsWorkspace />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Ingredient Requests" }),
    ).toBeVisible();
    expect(
      screen.getByText(
        "Track ingredients you've asked Recipe Lab to add to the catalog.",
      ),
    ).toBeVisible();
    expect(screen.queryByText("Catalog requests")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Back to My Recipes/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "My ingredient requests" }),
    ).toBeVisible();
    expect(screen.getByRole("main")).toHaveClass(
      "account-workspace-page",
      "account-ingredient-requests-page",
    );
    expect(
      screen.queryByRole("button", { name: /^Use / }),
    ).not.toBeInTheDocument();
  });

  it("opens the missing-ingredient request dialog from the page header", async () => {
    render(<MyIngredientRequestsWorkspace />);

    const trigger = screen.getByRole("button", {
      name: "Request an ingredient",
    });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute(
      "aria-controls",
      "account-new-ingredient-request-request-dialog",
    );

    fireEvent.click(trigger);

    expect(
      await screen.findByRole("dialog", {
        name: "Request a missing ingredient",
      }),
    ).toBeVisible();
    expect(screen.queryByText("Ingredient catalog")).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Proposed ingredient name" }),
    ).toHaveValue("");

    fireEvent.click(
      screen.getByRole("button", { name: "Close ingredient request dialog" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
