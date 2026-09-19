import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "./auth-session-provider";
import { DemoSessionDetails } from "./demo-session-details";

const temporarySession = {
  status: "authenticated" as const,
  temporary: true,
  expires_at: "2026-09-20T16:00:37Z",
  user: {
    id: "demo-id",
    display_name: "Demo cook",
    handle: "demo-cook",
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DemoSessionDetails", () => {
  it("shows the authenticated demo account's expiry, privacy, and contact details", async () => {
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
      <AuthSessionProvider initialSession={temporarySession}>
        <DemoSessionDetails />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", {
        name: "About your demo account",
        level: 2,
      }),
    ).toBeVisible();
    expect(
      await screen.findByText(/please don’t include personal or sensitive information/),
    ).toBeVisible();
    expect(screen.getByText(/Sun, Sep 20 at 4:00 PM GMT/)).toBeVisible();
    expect(
      screen.getByRole("link", {
        name: "Contact me@peterbucci.com",
      }),
    ).toHaveAttribute("href", "mailto:me@peterbucci.com");
    expect(
      screen.getByRole("link", { name: "Return to Recipe Lab" }),
    ).toHaveAttribute("href", "/");
  });

  it("keeps a failed details lookup retryable", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(
        Response.json({
          enabled: true,
          generation_id: "f80a52ee-02ac-479e-a8db-848a2b093638",
          expires_at: temporarySession.expires_at,
          contact_url: "mailto:me@peterbucci.com",
        }),
      );
    vi.stubGlobal("fetch", request);

    render(
      <AuthSessionProvider initialSession={temporarySession}>
        <DemoSessionDetails />
      </AuthSessionProvider>,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t load the current demo details. Please retry.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("link", {
        name: "Contact me@peterbucci.com",
      }),
    ).toBeVisible();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("does not load sandbox details for a permanent account", () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);

    render(
      <AuthSessionProvider
        initialSession={{ ...temporarySession, temporary: false, expires_at: null }}
      >
        <DemoSessionDetails />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByText(/Your current account is not a demo account/),
    ).toBeVisible();
    expect(request).not.toHaveBeenCalled();
  });
});
