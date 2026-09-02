import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemberRouteGate } from "./member-route-gate";

const authSession = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  state: { phase: "error" } as
    | { phase: "error" }
    | { phase: "ready"; session: { status: "anonymous" } },
}));

vi.mock("./auth-session-provider", () => ({
  useAuthSession: () => ({
    refreshSession: authSession.refreshSession,
    state: authSession.state,
  }),
}));

describe("MemberRouteGate account recovery", () => {
  it("uses the shared blocking-error pattern and preserves both exits", () => {
    authSession.state = { phase: "error" };
    render(
      <MemberRouteGate
        eyebrow="Your Recipe Lab"
        returnTo="/account/activity"
        title="Your activity"
      >
        <p>Private content</p>
      </MemberRouteGate>,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("auth-card", "blocking-error-state");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(
      screen.getByRole("heading", { name: "We couldn’t check your account" }),
    ).toBeVisible();
    expect(screen.queryByText("Your Recipe Lab")).not.toBeInTheDocument();
    expect(screen.queryByText("Your activity")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(authSession.refreshSession).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Retry account check" })).toBeNull();
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });

  it("uses one centered, eyebrow-free message for shared anonymous routes", () => {
    authSession.state = {
      phase: "ready",
      session: { status: "anonymous" },
    };
    render(
      <MemberRouteGate
        eyebrow="Private recipe workspace"
        returnTo="/recipes/new"
        title="Private drafts"
      >
        <p>Private content</p>
      </MemberRouteGate>,
    );

    const card = screen
      .getByRole("heading", { name: "Page Unavailable" })
      .closest("section");
    expect(card).toHaveClass("member-route-gate--shared-anonymous");
    expect(screen.getByText("Please sign in to continue")).toBeVisible();
    expect(screen.queryByText("Private recipe workspace")).not.toBeInTheDocument();
    expect(screen.queryByText("Private drafts")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Frecipes%2Fnew",
    );
    expect(screen.getByRole("link", { name: "Browse Recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });
});
