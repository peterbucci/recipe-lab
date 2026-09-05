import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageLoadingSkeleton } from "./page-loading-skeleton";

afterEach(() => {
  vi.useRealTimers();
});

describe("page loading skeleton", () => {
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
