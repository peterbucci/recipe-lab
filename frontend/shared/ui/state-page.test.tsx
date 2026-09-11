import { fireEvent, render, screen, within } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it, vi } from "vitest";

import { RetryableStatePage } from "./retryable-state-page";
import { StatePage, StatePanel } from "./state-page";

describe("route state primitives", () => {
  it("renders an ordinary, labelled route state without announcing an alert", () => {
    render(
      <StatePage className="domain-page">
        <StatePanel
          className="domain-panel"
          description="Choose another destination."
          headingId="missing-page-title"
          title="This page is missing."
        />
      </StatePage>,
    );

    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("id", "main-content");
    expect(main).toHaveClass("state-page", "domain-page");

    const panel = screen
      .getByRole("heading", { level: 1, name: "This page is missing." })
      .closest("section");
    expect(panel).toHaveClass("state-panel", "domain-panel");
    expect(panel).toHaveAttribute("aria-labelledby", "missing-page-title");
    expect(panel).toHaveAttribute(
      "aria-describedby",
      "missing-page-title-description",
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("supports opt-in alerts, an eyebrow, and caller-owned actions", () => {
    render(
      <StatePage>
        <StatePanel
          actions={<Link href="/recipes">Browse recipes</Link>}
          actionsClassName="domain-actions"
          alert
          description="Try a different recipe."
          descriptionClassName="domain-description"
          eyebrow="Not found"
          headingId="recipe-state-title"
          title="This recipe isn’t available."
        />
      </StatePage>,
    );

    const alert = screen.getByRole("alert");
    expect(within(alert).getByText("Not found")).toHaveClass("eyebrow");
    expect(within(alert).getByText("Try a different recipe.")).toHaveClass(
      "domain-description",
    );
    expect(within(alert).getByRole("link", { name: "Browse recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
    expect(within(alert).getByRole("link").parentElement).toHaveClass(
      "state-panel__actions",
      "button-row",
      "domain-actions",
    );
  });

  it("owns retry mechanics while preserving secondary actions and caller classes", () => {
    const retry = vi.fn();
    render(
      <RetryableStatePage
        actionsClassName="retry-actions"
        className="catalog-state-page"
        description="Try again or leave."
        descriptionClassName="retry-description"
        eyebrow="Something went wrong"
        headingId="catalog-error-title"
        panelClassName="catalog-state-panel"
        retry={retry}
        secondaryAction={<Link href="/">Return home</Link>}
        title="We couldn’t load the recipes."
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass(
      "state-panel",
      "error-state",
      "catalog-state-panel",
    );
    expect(within(alert).getByText("Try again or leave.")).toHaveClass(
      "retry-description",
    );
    expect(within(alert).getByRole("button").parentElement).toHaveClass(
      "retry-actions",
    );
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
    expect(within(alert).getByRole("link", { name: "Return home" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});
