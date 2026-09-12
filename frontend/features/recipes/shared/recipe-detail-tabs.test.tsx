import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RecipeDetailTabs } from "./recipe-detail-tabs";

function renderTabs(className?: string) {
  return render(
    <RecipeDetailTabs
      className={className}
      recipe={<p>Recipe content</p>}
      notes={<p>Notes content</p>}
      family={<p>Family content</p>}
    />,
  );
}

describe("RecipeDetailTabs", () => {
  beforeEach(() => {
    window.history.replaceState(
      null,
      "",
      "/recipes/test/compare?base_version_id=base#recipe-notes",
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  it("uses the shared automatic tab behavior while keeping canonical hashes", () => {
    const replaceState = vi.spyOn(window.history, "replaceState");
    renderTabs();

    const tablist = screen.getByRole("tablist", { name: "Recipe sections" });
    const recipe = within(tablist).getByRole("tab", { name: "Recipe" });
    const notes = within(tablist).getByRole("tab", { name: "Notes" });
    const family = within(tablist).getByRole("tab", { name: "Family" });

    expect(notes).toHaveAttribute("aria-selected", "true");
    expect(notes).toHaveAttribute("aria-controls", "recipe-panel-notes");
    expect(screen.getByRole("tabpanel", { name: "Notes" })).toHaveTextContent(
      "Notes content",
    );
    expect(document.getElementById("recipe-panel-recipe")).toHaveAttribute(
      "hidden",
    );

    notes.focus();
    fireEvent.click(family);
    expect(family).toHaveAttribute("aria-selected", "true");
    expect(notes).toHaveFocus();
    expect(replaceState).toHaveBeenLastCalledWith(
      null,
      "",
      "#recipe-family",
    );
    expect(window.location.hash).toBe("#recipe-family");
    expect(window.location.pathname).toBe("/recipes/test/compare");
    expect(window.location.search).toBe("?base_version_id=base");

    fireEvent.keyDown(family, { key: "ArrowRight" });
    expect(recipe).toHaveFocus();
    expect(recipe).toHaveAttribute("aria-selected", "true");
    expect(window.location.hash).toBe("#ingredients");
  });

  it("selects hash aliases and hash changes without moving focus", () => {
    renderTabs();

    const recipe = screen.getByRole("tab", { name: "Recipe" });
    const notes = screen.getByRole("tab", { name: "Notes" });
    const family = screen.getByRole("tab", { name: "Family" });
    notes.focus();

    window.history.replaceState(null, "", "#recipe-family");
    fireEvent(window, new HashChangeEvent("hashchange"));
    expect(family).toHaveAttribute("aria-selected", "true");
    expect(notes).toHaveFocus();

    for (const hash of ["#instructions", "#ingredients"]) {
      window.history.replaceState(null, "", hash);
      fireEvent(window, new HashChangeEvent("hashchange"));
      expect(recipe).toHaveAttribute("aria-selected", "true");
      expect(notes).toHaveFocus();
    }
  });

  it("adds an optional composition class without replacing the shared tab class", () => {
    const { container } = renderTabs("recipe-comparison-tabs");

    expect(container.firstElementChild).toHaveClass(
      "recipe-detail__tabs",
      "recipe-comparison-tabs",
    );
  });
});
