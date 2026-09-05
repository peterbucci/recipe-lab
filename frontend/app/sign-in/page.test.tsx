import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import SignInPage from "./page";

describe("SignInPage", () => {
  it("keeps anonymous browsing available and explains member benefits", async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({ return_to: "/recipes?q=carrot" }),
      }),
    );

    expect(screen.getByRole("heading", { name: "Sign in to Recipe Lab" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveClass(
      "account-access-page",
      "account-access-page--sign-in",
    );
    const shell = screen
      .getByRole("heading", { name: "Sign in to Recipe Lab" })
      .closest("section");
    expect(shell).toHaveClass("account-access-card", "account-access-card--sign-in");
    expect(screen.getByRole("complementary", { name: "Why sign in" })).toBeVisible();
    expect(screen.getByText("Your recipes, saved for later.")).toBeVisible();
    const benefits = screen.getByRole("list", { name: "Account benefits" });
    expect(within(benefits).getAllByRole("listitem")).toHaveLength(3);
    expect(within(benefits).getByText("Save recipes")).toBeVisible();
    expect(within(benefits).getByText("Make your own versions")).toBeVisible();
    expect(within(benefits).getByText("Keep private drafts")).toBeVisible();
    expect(
      screen.getByText(/doesn't collect your password on this page/i),
    ).toBeVisible();
    expect(screen.queryByText(/recommend/i)).toBeNull();
    expect(screen.queryByText(/demo/i)).toBeNull();
    const continueLink = screen.getByRole("link", { name: "Continue to sign in" });
    expect(continueLink).toHaveTextContent("Continue to secure sign in");
    expect(continueLink).toHaveAttribute(
      "href",
      "/api/auth/login?return_to=%2Frecipes%3Fq%3Dcarrot",
    );
    expect(screen.getByRole("link", { name: "Keep browsing" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });

  it("does not put an external return destination into the login URL", async () => {
    render(
      await SignInPage({
        searchParams: Promise.resolve({ return_to: "https://malicious.example/steal" }),
      }),
    );

    expect(screen.getByRole("link", { name: "Continue to sign in" })).toHaveAttribute(
      "href",
      "/api/auth/login?return_to=%2Frecipes",
    );
  });
});
