import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../lib/auth-api";
import { AccountSettings } from "./account-settings";
import { AuthSessionProvider } from "./auth-session-provider";

const routerMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

const member = {
  status: "authenticated" as const,
  user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
};

function renderSettings() {
  return render(
    <AuthSessionProvider initialSession={member}>
      <AccountSettings />
    </AuthSessionProvider>,
  );
}

function confirmDeletion() {
  fireEvent.click(
    screen.getByRole("checkbox", { name: /account deletion is permanent/i }),
  );
  fireEvent.change(screen.getByLabelText(/type alice to confirm/i), {
    target: { value: "alice" },
  });
}

afterEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  routerMocks.refresh.mockReset();
  routerMocks.replace.mockReset();
  vi.unstubAllGlobals();
});

describe("AccountSettings", () => {
  it("requires both acknowledgements and completes deletion through the protected endpoint", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();

    expect(screen.getByRole("heading", { name: "Delete account" })).toBeVisible();
    expect(screen.getByText(/recipes that are public when you delete/i)).toHaveTextContent(
      /Deleted cook.*withdrew stay unavailable permanently/i,
    );
    const deleteButton = screen.getByRole("button", { name: "Permanently delete account" });
    expect(deleteButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/type alice to confirm/i), {
      target: { value: "Alice" },
    });
    expect(deleteButton).toBeDisabled();
    confirmDeletion();
    expect(deleteButton).toBeEnabled();
    fireEvent.click(deleteButton);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/account",
        expect.objectContaining({
          method: "DELETE",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-CSRF-Token": "csrf-value",
          },
          body: JSON.stringify({ confirmation: "alice" }),
        }),
      ),
    );
    expect(routerMocks.replace).toHaveBeenCalledWith("/account/deleted");
    expect(routerMocks.refresh).toHaveBeenCalledOnce();
  });

  it("clears destructive confirmation and uses a full-page identity verification journey", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "recent_authentication_required",
              message: "private age detail",
              issues: [],
            },
          },
          { status: 403 },
        ),
      ),
    );
    renderSettings();
    confirmDeletion();
    fireEvent.click(screen.getByRole("button", { name: "Permanently delete account" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sign in again to verify your identity");
    expect(screen.queryByDisplayValue("alice")).toBeNull();
    expect(screen.getByRole("link", { name: "Verify identity" })).toHaveAttribute(
      "href",
      "/api/auth/reauthenticate?return_to=%2Faccount%2Fsettings",
    );
    expect(screen.queryByText("private age detail")).toBeNull();
  });

  it("refreshes the session after a network ambiguity and treats anonymous as deleted", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("connection dropped"))
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }));
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();
    confirmDeletion();
    fireEvent.click(screen.getByRole("button", { name: "Permanently delete account" }));

    await waitFor(() => expect(routerMocks.replace).toHaveBeenCalledWith("/account/deleted"));
    expect(fetchMock.mock.calls[1]).toEqual([
      "/api/auth/session",
      expect.objectContaining({ method: "GET", credentials: "same-origin" }),
    ]);
  });

  it("does not expose deletion controls to an anonymous visitor", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <AccountSettings />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("heading", { name: "Sign in to manage your account." })).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute(
      "href",
      "/api/auth/login?return_to=%2Faccount%2Fsettings",
    );
    expect(screen.queryByRole("button", { name: /delete account/i })).toBeNull();
  });

  it("lets a member delete before choosing a public handle", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthSessionProvider
        initialSession={{
          status: "onboarding_required",
          user: { id: "cook-id", display_name: "New Cook", handle: null },
        }}
      >
        <AccountSettings />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("heading", { name: "Delete account" })).toBeVisible();
    expect(screen.getByRole("link", { name: "← Back to recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /account deletion is permanent/i }),
    );
    fireEvent.change(screen.getByLabelText(/type DELETE to confirm/i), {
      target: { value: "DELETE" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Permanently delete account" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/account",
        expect.objectContaining({
          method: "DELETE",
          body: JSON.stringify({ confirmation: "DELETE" }),
        }),
      ),
    );
    expect(routerMocks.replace).toHaveBeenCalledWith("/account/deleted");
  });
});
