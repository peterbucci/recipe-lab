import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { WorkspacePagination } from "./workspace-pagination";
import { WorkspaceErrorState, WorkspaceLoadingState } from "./workspace-state";
import { WorkspaceTabs } from "./workspace-tab-menu";

function TabsFixture() {
  const [active, setActive] = useState<
    "profile" | "notifications" | "danger"
  >("profile");
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
            id: "notifications-tab",
            label: "Notifications",
            panelId: "notifications-panel",
            value: "notifications",
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
      <section
        id="profile-panel"
        role="tabpanel"
        aria-labelledby="profile-tab"
        hidden={active !== "profile"}
      />
      <section
        id="notifications-panel"
        role="tabpanel"
        aria-labelledby="notifications-tab"
        hidden={active !== "notifications"}
      />
      <section
        id="danger-panel"
        role="tabpanel"
        aria-labelledby="danger-tab"
        hidden={active !== "danger"}
      />
    </>
  );
}

describe("workspace primitives", () => {
  it("provides roving, automatically activated tabs with optional count badges", () => {
    render(<TabsFixture />);

    const tablist = screen.getByRole("tablist", { name: "Settings categories" });
    const profile = within(tablist).getByRole("tab", { name: "Profile" });
    const notifications = within(tablist).getByRole("tab", {
      name: "Notifications",
    });
    const danger = within(tablist).getByRole("tab", { name: "Danger zone" });

    expect(profile).toHaveAttribute("aria-selected", "true");
    expect(profile).toHaveAttribute("tabindex", "0");
    expect(profile).toHaveAttribute("aria-controls", "profile-panel");
    expect(screen.getByRole("tabpanel", { name: "Profile" })).toHaveAttribute(
      "id",
      "profile-panel",
    );
    expect(within(profile).getByText("1")).toHaveAttribute("aria-hidden", "true");

    profile.focus();
    fireEvent.keyDown(profile, { key: "ArrowLeft" });
    expect(danger).toHaveFocus();
    expect(danger).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(danger, { key: "ArrowRight" });
    expect(profile).toHaveFocus();
    expect(profile).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(profile, { key: "ArrowRight" });
    expect(notifications).toHaveFocus();
    expect(notifications).toHaveAttribute("aria-selected", "true");
    expect(profile).toHaveAttribute("tabindex", "-1");

    fireEvent.keyDown(notifications, { key: "End" });
    expect(danger).toHaveFocus();
    expect(danger).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(danger, { key: "Home" });
    expect(profile).toHaveFocus();
    expect(profile).toHaveAttribute("aria-selected", "true");

    fireEvent.click(danger);
    expect(danger).toHaveAttribute("aria-selected", "true");
    expect(profile).toHaveFocus();
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

  it("renders accessible link pagination without linking disabled bounds", () => {
    render(
      <WorkspacePagination
        currentPage={1}
        hrefForPage={(page) => `/recipes?page=${page}`}
        label="Recipe result pages"
        totalPages={3}
      />,
    );

    const pagination = screen.getByRole("navigation", {
      name: "Recipe result pages",
    });
    const previous = within(pagination).getByText("← Previous");
    expect(previous).toHaveAttribute("aria-disabled", "true");
    expect(previous).not.toHaveAttribute("href");
    expect(within(pagination).getByText("Page 1 of 3")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(pagination).getByRole("link", { name: "Next →" })).toHaveAttribute(
      "href",
      "/recipes?page=2",
    );
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
