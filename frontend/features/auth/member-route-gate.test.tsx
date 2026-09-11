import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSessionState } from "./auth-session-provider";
import { MemberRouteGate } from "./member-route-gate";

const authSession = vi.hoisted(() => ({
  refreshSession: vi.fn(),
  state: { phase: "error" } as AuthSessionState,
}));

vi.mock("./auth-session-provider", () => ({
  useAuthSession: () => ({
    refreshSession: authSession.refreshSession,
    state: authSession.state,
  }),
}));

function renderGate(signedOutDescription?: string) {
  return render(
    <MemberRouteGate
      returnTo="/account/activity"
      signedOutDescription={signedOutDescription}
    >
      <p>Private content</p>
    </MemberRouteGate>,
  );
}

describe("MemberRouteGate", () => {
  beforeEach(() => {
    authSession.refreshSession.mockReset();
  });

  it("presents a retryable account-check failure without mounting protected children", () => {
    authSession.state = { phase: "error" };
    renderGate();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("auth-card", "blocking-error-state");
    expect(alert).toHaveTextContent("Something went wrong");
    expect(
      screen.getByRole("heading", { name: "We couldn’t check your account." }),
    ).toBeVisible();
    expect(screen.getByText("Try checking your account again.")).toBeVisible();
    expect(screen.queryByText("Private content")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(authSession.refreshSession).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });

  it("uses one ordinary signed-out state and preserves the return destination", () => {
    authSession.state = {
      phase: "ready",
      session: { status: "anonymous" },
    };
    renderGate("Your activity belongs only to your account.");

    expect(
      screen.getByRole("heading", { name: "Sign in to continue." }),
    ).toBeVisible();
    expect(
      screen.getByText("Your activity belongs only to your account."),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Private content")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Faccount%2Factivity",
    );
  });

  it("uses an ordinary setup state before mounting protected children", () => {
    authSession.state = {
      phase: "ready",
      session: {
        status: "onboarding_required",
        user: { id: "member-id", display_name: "Member", handle: null },
      },
    };
    renderGate();

    expect(
      screen.getByRole("heading", { name: "Finish setting up your account." }),
    ).toBeVisible();
    expect(screen.getByText("Complete your profile to continue.")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Private content")).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Finish account setup" }),
    ).toHaveAttribute("href", "/onboarding?return_to=%2Faccount%2Factivity");
  });

  it("keeps protected children unmounted while the account check is loading", () => {
    authSession.state = { phase: "loading" };
    renderGate();

    expect(screen.getByRole("status")).toHaveTextContent("Checking your account…");
    expect(screen.queryByText("Private content")).not.toBeInTheDocument();
  });

  it("mounts protected children only after member access is established", () => {
    authSession.state = {
      phase: "ready",
      session: {
        status: "authenticated",
        user: { id: "member-id", display_name: "Member", handle: "member" },
      },
    };
    renderGate();

    expect(screen.getByText("Private content")).toBeVisible();
    expect(screen.queryByRole("main")).not.toBeInTheDocument();
  });
});
