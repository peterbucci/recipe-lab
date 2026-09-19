import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSessionProvider } from "../../features/auth/auth-session-provider";

import SignInPage from "./page";

const nextMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nextMocks.replace, refresh: nextMocks.refresh }),
}));

beforeEach(() => {
  nextMocks.replace.mockReset();
  nextMocks.refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ enabled: false })));
});
afterEach(() => vi.unstubAllGlobals());

describe("SignInPage", () => {
  it("keeps anonymous browsing available without duplicating sign-in promotion", async () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>{await SignInPage({
        searchParams: Promise.resolve({ return_to: "/recipes?q=carrot" }),
      })}</AuthSessionProvider>,
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
    expect(screen.queryByText("Recipe Lab account")).toBeNull();
    expect(screen.queryByRole("list", { name: "Account benefits" })).toBeNull();
    expect(
      screen.queryByText(
        "Continue to secure sign-in, then you'll continue where you left off.",
      ),
    ).toBeNull();
    const securityNote = (
      await screen.findByText(/doesn't collect your password on this page/i)
    ).closest(".sign-in-security-note");
    expect(securityNote).toBeVisible();
    expect(screen.queryByText(/recommend/i)).toBeNull();
    expect(screen.queryByText(/demo/i)).toBeNull();
    const continueLink = screen.getByRole("link", { name: "Continue to sign in" });
    expect(continueLink).toHaveTextContent("Continue to secure sign in");
    expect(continueLink).toHaveAttribute(
      "href",
      "/api/auth/login?return_to=%2Frecipes%3Fq%3Dcarrot",
    );
    expect(continueLink.closest(".sign-in-card__actions")?.nextElementSibling).toBe(
      securityNote,
    );
    expect(screen.getByRole("link", { name: "Keep browsing" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });

  it("does not put an external return destination into the login URL", async () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>{await SignInPage({
        searchParams: Promise.resolve({ return_to: "https://malicious.example/steal" }),
      })}</AuthSessionProvider>,
    );

    expect(await screen.findByRole("link", { name: "Continue to sign in" })).toHaveAttribute(
      "href",
      "/api/auth/login?return_to=%2Frecipes",
    );
  });

  it("presents the temporary account experience when the portfolio demo is enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          enabled: true,
          generation_id: "f80a52ee-02ac-479e-a8db-848a2b093638",
          expires_at: "2026-09-20T19:42:37Z",
          contact_url: "mailto:me@peterbucci.com",
        }),
      ),
    );

    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        {await SignInPage({ searchParams: Promise.resolve({}) })}
      </AuthSessionProvider>,
    );

    expect(
      await screen.findByRole("heading", { name: "Try Recipe Lab", level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByRole("complementary", { name: "About the Recipe Lab demo" }),
    ).toBeVisible();
    expect(screen.getByText("Explore Recipe Lab for yourself.")).toBeVisible();
    expect(
      screen.getByText(
        "Save recipes, create your own versions, publish, and come back to your work while your demo account is active.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Start the demo" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Keep browsing" })).toBeVisible();
  });

  it("forwards an existing member session to the member homepage", async () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        {await SignInPage({ searchParams: Promise.resolve({ return_to: "/recipes/new" }) })}
      </AuthSessionProvider>,
    );

    await waitFor(() => expect(nextMocks.replace).toHaveBeenCalledWith("/"));
    expect(screen.queryByRole("heading", { name: "Sign in to Recipe Lab" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Continue to the app" })).toBeNull();
  });

  it("forwards an incomplete signed-in account to setup with its safe destination", async () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "onboarding_required",
          user: { id: "cook-id", display_name: "Alice Cook", handle: null },
        }}
      >
        {await SignInPage({ searchParams: Promise.resolve({ return_to: "/recipes/new" }) })}
      </AuthSessionProvider>,
    );

    await waitFor(() =>
      expect(nextMocks.replace).toHaveBeenCalledWith(
        "/onboarding?return_to=%2Frecipes%2Fnew",
      ),
    );
  });
});
