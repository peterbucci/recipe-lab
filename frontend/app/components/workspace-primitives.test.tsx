import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { WorkspacePagination } from "./workspace-pagination";
import { WorkspaceErrorState, WorkspaceLoadingState } from "./workspace-state";
import { WorkspaceTabs } from "./workspace-tab-menu";

function TabsFixture() {
  const [active, setActive] = useState<"profile" | "danger">("profile");
  return (
    <>
      <WorkspaceTabs
        ariaLabel="Settings categories"
        value={active}
        onChange={setActive}
        items={[
          {
            count: 1,
            id: "profile-tab",
            label: "Profile",
            panelId: "profile-panel",
            value: "profile",
          },
          {
            count: 1,
            id: "danger-tab",
            label: "Danger zone",
            panelId: "danger-panel",
            value: "danger",
          },
        ]}
      />
      <section id="profile-panel" role="tabpanel" hidden={active !== "profile"} />
      <section id="danger-panel" role="tabpanel" hidden={active !== "danger"} />
    </>
  );
}

describe("workspace primitives", () => {
  it("provides roving, automatically activated tabs with optional count badges", () => {
    render(<TabsFixture />);

    const tablist = screen.getByRole("tablist", { name: "Settings categories" });
    const profile = within(tablist).getByRole("tab", { name: "Profile" });
    const danger = within(tablist).getByRole("tab", { name: "Danger zone" });

    expect(profile).toHaveAttribute("aria-selected", "true");
    expect(profile).toHaveAttribute("tabindex", "0");
    expect(within(profile).getByText("1")).toHaveAttribute("aria-hidden", "true");

    fireEvent.keyDown(profile, { key: "ArrowRight" });
    expect(danger).toHaveFocus();
    expect(danger).toHaveAttribute("aria-selected", "true");
    expect(profile).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(danger, { key: "Home" });
    expect(profile).toHaveFocus();
    expect(profile).toHaveAttribute("aria-selected", "true");
  });

  it("uses one bounded pagination contract for loading and page limits", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <WorkspacePagination
        currentPage={1}
        label="Request pages"
        onPageChange={onPageChange}
        totalPages={3}
      />,
    );

    const pagination = screen.getByRole("navigation", { name: "Request pages" });
    expect(within(pagination).getByRole("button", { name: "← Previous" })).toBeDisabled();
    fireEvent.click(within(pagination).getByRole("button", { name: "Next →" }));
    expect(onPageChange).toHaveBeenCalledWith(2);

    rerender(
      <WorkspacePagination
        currentPage={2}
        label="Request pages"
        loading
        onPageChange={onPageChange}
        totalPages={3}
      />,
    );
    expect(within(pagination).getByRole("button", { name: "← Previous" })).toBeDisabled();
    expect(within(pagination).getByRole("button", { name: "Next →" })).toBeDisabled();
  });

  it("standardizes panel errors and accessible loading feedback", () => {
    render(
      <>
        <WorkspaceErrorState
          action={<button type="button">Try again</button>}
          message="The queue could not be loaded."
          title="Queue unavailable"
        />
        <WorkspaceLoadingState label="Loading requests…" layout="rows" />
      </>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("workspace-state", "workspace-state--error");
    expect(within(alert).getByRole("heading", { level: 3 })).toHaveTextContent(
      "Queue unavailable",
    );
    expect(screen.getByRole("status")).toHaveTextContent("Loading requests…");
  });
});
