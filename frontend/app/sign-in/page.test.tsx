import { render, screen } from "@testing-library/react";
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
    expect(screen.getByRole("heading", { name: "Sign in to Recipe Lab" }).closest("section"))
      .toHaveClass("account-access-card", "account-access-card--sign-in");
    expect(screen.getByText(/save and rate recipes/i)).toBeVisible();
    expect(screen.getByText(/create your own versions/i)).toBeVisible();
    expect(screen.queryByText(/recommend/i)).toBeNull();
    expect(screen.queryByText(/demo/i)).toBeNull();
    expect(screen.getByRole("link", { name: "Continue to sign in" })).toHaveAttribute(
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
