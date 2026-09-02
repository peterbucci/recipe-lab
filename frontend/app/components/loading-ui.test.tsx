import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AuthGateLoading,
  InlineLoading,
  LoadingButton,
  PageLoadingSkeleton,
  SectionLoading,
} from "./loading-ui";

afterEach(() => {
  vi.useRealTimers();
});

describe("shared loading UI", () => {
  it("gives a page skeleton one live region and hides decorative shapes", () => {
    const { container } = render(
      <PageLoadingSkeleton
        label="Loading recipes…"
        variant="catalog"
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Loading recipes…");
    expect(container.querySelector("main")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(container.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThan(0);
  });

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

  it("offers a safe exit when a page wait becomes unusually long", () => {
    vi.useFakeTimers();
    render(
      <PageLoadingSkeleton label="Loading recipes…" variant="catalog" />,
    );

    expect(screen.queryByText(/taking longer than usual/i)).toBeNull();
    act(() => vi.advanceTimersByTime(8_000));

    const longWaitCopy = screen.getAllByText(/taking longer than usual/i);
    expect(longWaitCopy).toHaveLength(2);
    expect(longWaitCopy[1]).toBeVisible();
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });
});
