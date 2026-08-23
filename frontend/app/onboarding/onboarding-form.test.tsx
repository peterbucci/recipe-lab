import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../lib/auth-api";
import { AuthSessionProvider } from "../components/auth-session-provider";
import { OnboardingForm } from "./onboarding-form";

const routerMocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

const onboardingSession = {
  status: "onboarding_required" as const,
  user: { id: "cook-id", display_name: "Alice Cook", handle: null },
};

afterEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  routerMocks.refresh.mockReset();
  routerMocks.replace.mockReset();
  vi.unstubAllGlobals();
});

function renderForm() {
  render(
    <AuthSessionProvider initialSession={onboardingSession}>
      <OnboardingForm returnTo="/recipes?q=carrot" />
    </AuthSessionProvider>,
  );
}

describe("OnboardingForm", () => {
  it("validates the unique public handle without sending an invalid request", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "-A" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish account setup" }));

    expect(screen.getByLabelText("Handle")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Handle")).toHaveFocus();
    expect(screen.getByText("Handle must be between 3 and 30 characters.")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects invisible Unicode formatting characters in a display name", () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "Alice\u200BCook" },
    });
    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish account setup" }));

    expect(
      screen.getByText("Display name contains an invisible or unsupported character."),
    ).toBeVisible();
    expect(screen.getByLabelText("Display name")).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes and saves the profile with the readable CSRF cookie", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        status: "authenticated",
        user: { id: "cook-id", display_name: "Alice B. Cook", handle: "alice_cook" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderForm();

    fireEvent.change(screen.getByLabelText("Display name"), {
      target: { value: "  Alice B. Cook  " },
    });
    fireEvent.change(screen.getByLabelText("Handle"), {
      target: { value: "Alice_Cook" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Finish account setup" }));

    await waitFor(() => expect(routerMocks.replace).toHaveBeenCalledWith("/recipes?q=carrot"));
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
          display_name: "Alice B. Cook",
          handle: "alice_cook",
        }),
      }),
    );
    expect(routerMocks.refresh).toHaveBeenCalledOnce();
  });

  it("keeps entered values and focuses the user on an unavailable handle", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "handle_unavailable",
              message: "That handle is unavailable.",
              issues: [],
            },
          },
          { status: 409 },
        ),
      ),
    );
    renderForm();

    fireEvent.change(screen.getByLabelText("Handle"), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Finish account setup" }));

    expect(
      await screen.findByText("That handle is unavailable. Try another one."),
    ).toBeVisible();
    expect(screen.getByLabelText("Handle")).toHaveValue("alice");
    await waitFor(() => expect(screen.getByLabelText("Handle")).toHaveFocus());
    expect(screen.getByLabelText("Display name")).toHaveValue("Alice Cook");
  });

  it("recovers anonymous visitors without hiding public browsing", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <OnboardingForm returnTo="/recipes" />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("Sign in to finish account setup");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Fonboarding",
    );
  });
});
