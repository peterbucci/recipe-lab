import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  AuthGateLoading,
  InlineLoading,
  LoadingButton,
  SectionLoading,
} from "./loading-ui";

describe("shared loading UI", () => {
  it("uses skeletons initially and a compact indicator while refreshing", () => {
    const { rerender } = render(
      <SectionLoading label="Loading your recipes…" layout="cards" />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading your recipes…",
    );

    rerender(
      <SectionLoading
        label="Refreshing your recipes…"
        layout="cards"
        refreshing
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Refreshing your recipes…",
    );
  });

  it("keeps an action button stable and exposes specific pending copy", () => {
    const { rerender } = render(
      <LoadingButton pending={false} pendingLabel="Saving…">
        Save recipe
      </LoadingButton>,
    );
    expect(screen.getByRole("button", { name: "Save recipe" })).toBeEnabled();

    rerender(
      <LoadingButton pending pendingLabel="Saving…">
        Save recipe
      </LoadingButton>,
    );
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button")).toHaveAttribute("aria-busy", "true");
  });

  it("keeps compact icon actions accessible without showing pending copy", () => {
    render(
      <LoadingButton compact pending pendingLabel="Saving recipe…">
        Save
      </LoadingButton>,
    );

    expect(
      screen.getByRole("button", { name: "Saving recipe…" }),
    ).toBeDisabled();
    expect(screen.getByText("Saving recipe…")).toHaveClass("visually-hidden");
  });

  it("shares the same compact status treatment for gates and inline waits", () => {
    const { rerender } = render(
      <AuthGateLoading label="Checking your account…" />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking your account…",
    );

    rerender(<InlineLoading label="Searching ingredients…" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Searching ingredients…",
    );
  });

});
