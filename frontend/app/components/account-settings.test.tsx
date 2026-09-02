import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../lib/auth-api";
import { AccountSettings } from "./account-settings";
import { AuthSessionProvider, useAuthSession } from "./auth-session-provider";

const routerMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

const member = {
  status: "authenticated" as const,
  user: {
    id: "cook-id",
    display_name: "Alice Cook",
    handle: "alice",
    description: "Old profile description.",
  },
};

function renderSettings() {
  return render(
    <AuthSessionProvider initialSession={member}>
      <AccountSettings />
    </AuthSessionProvider>,
  );
}

function SessionDescriptionProbe() {
  const { state } = useAuthSession();
  const description =
    state.phase === "ready" && state.session.status !== "anonymous"
      ? state.session.user.description ?? ""
      : "";
  return <output aria-label="Saved session description">{description}</output>;
}

function confirmDeletion() {
  fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
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
  it("defaults to Profile and keeps its live preview draft mounted between tabs", () => {
    renderSettings();

    expect(screen.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
    expect(
      screen.getByText("Manage your public profile and account controls."),
    ).toBeVisible();
    const tablist = screen.getByRole("tablist", { name: "Settings categories" });
    const profileTab = within(tablist).getByRole("tab", { name: "Profile" });
    const dangerTab = within(tablist).getByRole("tab", { name: "Danger zone" });
    const profilePanel = screen.getByRole("tabpanel", { name: "Profile" });
    const dangerPanel = document.getElementById("account-settings-danger-panel");

    expect(dangerPanel).not.toBeNull();
    expect(profileTab).toHaveAttribute("aria-selected", "true");
    expect(profileTab).toHaveAttribute("aria-controls", "account-settings-profile-panel");
    expect(profilePanel).not.toHaveAttribute("hidden");
    const profileHeader = within(profilePanel)
      .getByRole("heading", { level: 2, name: "Public profile" })
      .closest("header");
    expect(profileHeader).toHaveClass("workspace-panel-header");
    expect(profileHeader).toHaveTextContent(
      "Control the short introduction shown on your public cook profile.",
    );
    expect(dangerTab).toHaveAttribute("aria-selected", "false");
    expect(dangerPanel).toHaveAttribute("hidden");

    const description = screen.getByLabelText("About you");
    const preview = screen.getByLabelText("Public profile preview");
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(screen.queryByText("Your account")).not.toBeInTheDocument();
    expect(within(preview).getByText("Alice Cook")).toBeVisible();
    expect(within(preview).getByText("@alice")).toBeVisible();
    const previewDescription = within(preview).getByText("Old profile description.");
    expect(previewDescription).toBeVisible();
    expect(previewDescription.parentElement).toHaveClass("account-settings__preview-identity");
    expect(previewDescription.parentElement).toContainElement(
      within(preview).getByText("@alice"),
    );

    fireEvent.change(description, { target: { value: "A live preview draft." } });
    expect(within(preview).getByText("A live preview draft.")).toBeVisible();
    expect(screen.getByText("21 / 500")).toBeVisible();

    fireEvent.click(dangerTab);
    expect(dangerTab).toHaveAttribute("aria-selected", "true");
    expect(profilePanel).toHaveAttribute("hidden");
    expect(dangerPanel).not.toHaveAttribute("hidden");
    const dangerHeader = within(dangerPanel!)
      .getByRole("heading", { level: 2, name: "Danger zone" })
      .closest("header");
    expect(dangerHeader).toHaveClass("workspace-panel-header");
    expect(dangerHeader).toHaveTextContent(
      "Permanent account actions that cannot be undone.",
    );

    fireEvent.click(profileTab);
    expect(description).toHaveValue("A live preview draft.");
  });

  it("supports arrow, Home, and End navigation across the settings tabs", () => {
    renderSettings();

    const profileTab = screen.getByRole("tab", { name: "Profile" });
    const dangerTab = screen.getByRole("tab", { name: "Danger zone" });

    profileTab.focus();
    fireEvent.keyDown(profileTab, { key: "ArrowRight" });
    expect(dangerTab).toHaveFocus();
    expect(dangerTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(dangerTab, { key: "ArrowLeft" });
    expect(profileTab).toHaveFocus();
    expect(profileTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(profileTab, { key: "End" });
    expect(dangerTab).toHaveFocus();
    expect(dangerTab).toHaveAttribute("aria-selected", "true");

    fireEvent.keyDown(dangerTab, { key: "Home" });
    expect(profileTab).toHaveFocus();
    expect(profileTab).toHaveAttribute("aria-selected", "true");
  });

  it("saves a trimmed public profile description through the protected profile endpoint", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: "authenticated",
        user: {
          ...member.user,
          description: "A practical home cook.",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();

    const description = screen.getByLabelText("About you");
    expect(description).toHaveValue("Old profile description.");
    fireEvent.change(description, { target: { value: "  A practical home cook.  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/session/profile",
        expect.objectContaining({
          method: "PATCH",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
            "X-CSRF-Token": "csrf-value",
          },
          body: JSON.stringify({
            handle: "alice",
            display_name: "Alice Cook",
            description: "A practical home cook.",
          }),
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Profile saved.");
    expect(description).toHaveValue("A practical home cook.");
    expect(screen.getByRole("link", { name: "View public profile" })).toHaveAttribute(
      "href",
      "/cooks/alice",
    );
  });

  it("clears the public profile description by submitting null", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: "authenticated",
        user: {
          ...member.user,
          description: null,
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();

    const description = screen.getByLabelText("About you");
    fireEvent.change(description, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/auth/session/profile",
        expect.objectContaining({
          body: JSON.stringify({
            handle: "alice",
            display_name: "Alice Cook",
            description: null,
          }),
        }),
      ),
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Profile saved.");
    expect(description).toHaveValue("");
    expect(
      within(screen.getByLabelText("Public profile preview")).getByText(
        "Your description will appear here.",
      ),
    ).toBeVisible();
  });

  it("keeps the typed draft and stored session description when saving fails", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthSessionProvider initialSession={member}>
        <AccountSettings />
        <SessionDescriptionProbe />
      </AuthSessionProvider>,
    );

    const description = screen.getByLabelText("About you");
    fireEvent.change(description, {
      target: { value: "A draft that has not been saved yet." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t save your profile description. Your previous description is unchanged.",
    );
    expect(description).toHaveValue("A draft that has not been saved yet.");
    expect(screen.getByLabelText("Saved session description")).toHaveTextContent(
      "Old profile description.",
    );
    expect(screen.queryByText("Profile saved.")).toBeNull();
  });

  it("requires both acknowledgements and completes deletion through the protected endpoint", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, { status: 204 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderSettings();

    fireEvent.click(screen.getByRole("tab", { name: "Danger zone" }));
    expect(screen.getByRole("heading", { name: "Delete account" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveClass("account-settings-page");
    expect(screen.getByRole("tabpanel", { name: "Danger zone" })).toHaveClass(
      "account-settings__panel--danger",
    );
    fireEvent.click(screen.getByText("What happens to my published recipes?"));
    expect(screen.getByText(/recipe-family history stays intact/i)).toBeVisible();
    expect(screen.queryByText(/forks remain intact/i)).not.toBeInTheDocument();
    expect(screen.getByText(/author name is replaced/i)).toHaveTextContent("Deleted cook");
    expect(screen.getByText(/withdrawn recipes remain unavailable/i)).toBeVisible();
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
    expect(screen.getByRole("main")).toHaveClass(
      "account-access-page",
      "account-access-page--settings",
    );
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

    expect(screen.queryByRole("tab", { name: "Profile" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Danger zone" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel", { name: "Danger zone" })).not.toHaveAttribute(
      "hidden",
    );
    expect(screen.getByRole("heading", { name: "Delete account" })).toBeVisible();
    expect(screen.queryByRole("navigation", { name: "Breadcrumb" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Back to/i })).not.toBeInTheDocument();
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

  it("keeps an unavailable session check inside the account settings recovery surface", async () => {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")));
    render(
      <AuthSessionProvider>
        <AccountSettings />
      </AuthSessionProvider>,
    );

    const loadingStatus = screen.getByRole("status");
    expect(loadingStatus).toHaveTextContent("Loading account settings");
    expect(loadingStatus.closest(".auth-gate-loading")).not.toBeNull();
    expect(screen.getByRole("main")).toHaveClass(
      "account-settings-page",
      "account-settings-page--loading",
    );

    expect(
      await screen.findByRole("heading", { name: "We couldn’t check your account." }),
    ).toBeVisible();
    expect(screen.getByRole("main")).toHaveClass(
      "account-access-page",
      "account-access-page--settings",
    );
    expect(screen.getByRole("button", { name: "Retry account check" })).toBeVisible();
  });
});
