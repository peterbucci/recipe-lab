import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AccountDeletedPage from "./account/deleted/page";
import AccountSettingsLoading from "./account/settings/loading";
import AuthCallbackError from "./auth/callback/error";
import AuthCallbackLoading from "./auth/callback/loading";
import OnboardingError from "./onboarding/error";
import OnboardingLoading from "./onboarding/loading";

describe("account lifecycle route states", () => {
  it("keeps callback loading and failure states visually scoped without changing recovery", () => {
    const { unmount } = render(<AuthCallbackLoading />);

    expect(screen.getByRole("main")).toHaveClass(
      "account-access-page",
      "account-access-page--callback",
    );
    expect(screen.getByRole("status").closest(".auth-gate-loading")).toHaveClass(
      "account-access-state",
      "account-access-state--loading",
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Finishing sign-in…");

    unmount();
    render(<AuthCallbackError />);

    expect(screen.getByRole("alert")).toHaveClass(
      "account-access-state",
      "account-access-state--error",
    );
    expect(screen.getByRole("link", { name: "Return to sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it("keeps onboarding loading and retry states visually scoped", () => {
    const retry = vi.fn();
    const { unmount } = render(<OnboardingLoading />);

    expect(screen.getByRole("main")).toHaveClass(
      "account-access-page",
      "account-access-page--onboarding",
    );
    expect(screen.getByRole("status").closest(".auth-gate-loading")).toHaveClass(
      "account-access-state--loading",
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Opening account setup…");

    unmount();
    render(<OnboardingError retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByRole("alert")).toHaveClass("account-access-state--error");
    expect(retry).toHaveBeenCalledOnce();
  });

  it("separates account settings loading from the signed-out deletion confirmation", () => {
    const { unmount } = render(<AccountSettingsLoading />);

    expect(screen.getByRole("main")).toHaveClass(
      "page-loading--settings",
      "account-settings-page",
      "account-settings-page--loading",
    );
    expect(screen.getByText("Settings")).toBeVisible();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Loading account settings");

    unmount();
    render(<AccountDeletedPage />);

    expect(screen.getByRole("main")).toHaveClass(
      "account-access-page--deleted",
      "account-deleted-page",
    );
    expect(screen.getByRole("heading", { name: "Your account has been deleted." }).closest("section"))
      .toHaveClass("account-deleted-card");
    expect(screen.getByText(/private account data was removed/i)).toBeVisible();
  });
});
