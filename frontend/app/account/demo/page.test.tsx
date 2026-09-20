import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../../features/auth/auth-session-provider";
import { MemberRouteGate } from "../../../features/auth/member-route-gate";
import DemoSessionDetailsPage from "./page";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DemoSessionDetailsPage", () => {
  it("uses the existing authenticated member route gate", () => {
    const page = DemoSessionDetailsPage();

    expect(page.type).toBe(MemberRouteGate);
    expect(page.props.returnTo).toBe("/account/demo");
    expect(page.props.signedOutDescription).toMatch(/demo account/);
  });

  it("uses the sign-in split card with the page purpose on the illustrated panel", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          enabled: true,
          generation_id: "f80a52ee-02ac-479e-a8db-848a2b093638",
          expires_at: "2026-09-20T17:00:37Z",
          contact_url: "mailto:me@peterbucci.com",
        }),
      ),
    );

    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          temporary: true,
          expires_at: "2026-09-20T16:00:37Z",
          user: {
            id: "demo-id",
            display_name: "Demo cook",
            handle: "demo-cook",
          },
        }}
      >
        <DemoSessionDetailsPage />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Temporary by design", level: 1 }),
    ).toBeVisible();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      screen.getByText(
        "Your demo account lets you try the full experience without creating a permanent account or sharing personal information.",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", {
        name: "About your demo account",
        level: 2,
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to Recipe Lab" }),
    ).toHaveClass("button--primary");
  });
});
