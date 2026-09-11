import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "../../features/auth/auth-api";
import { AuthSessionProvider } from "../../features/auth/auth-session-provider";
import { StaffWorkspaceAccess } from "./staff-workspace-access";

function staffSession(canReview: boolean): AuthSession {
  return {
    status: "authenticated",
    user: { id: "staff-id", display_name: "Sam Staff", handle: "sam" },
    capabilities: {
      review_ingredient_requests: canReview,
      moderate_recipe_reports: false,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});
describe("StaffWorkspaceAccess", () => {
  it("uses the shared loading surface while capabilities resolve", () => {
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => undefined)));

    render(
      <AuthSessionProvider>
        <StaffWorkspaceAccess
          capability="review_ingredient_requests"
        >
          {() => <p>Private review tools</p>}
        </StaffWorkspaceAccess>
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Checking your account…");
    expect(screen.queryByText("Private review tools")).not.toBeInTheDocument();
  });

  it("does not render protected slots without the required capability", () => {
    render(
      <AuthSessionProvider initialSession={staffSession(false)}>
        <StaffWorkspaceAccess
          capability="review_ingredient_requests"
        >
          {() => <p>Private review tools</p>}
        </StaffWorkspaceAccess>
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("heading", { name: "We couldn’t find that page." })).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Private review tools")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Browse recipes" })).toHaveAttribute(
      "href",
      "/recipes",
    );
  });

  it("retries an account-check failure before presenting concealed access", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json(staffSession(false)));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthSessionProvider>
        <StaffWorkspaceAccess
          capability="review_ingredient_requests"
        >
          {() => <p>Private review tools</p>}
        </StaffWorkspaceAccess>
      </AuthSessionProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "We couldn’t check your account." }),
    ).toBeVisible();
    expect(screen.queryByText("Private review tools")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("heading", { name: "We couldn’t find that page." }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("rechecks the account and hides protected slots after authorization is lost", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(staffSession(false)), {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuthSessionProvider initialSession={staffSession(true)}>
        <StaffWorkspaceAccess
          capability="review_ingredient_requests"
        >
          {(onAuthorizationLost) => (
            <button type="button" onClick={onAuthorizationLost}>
              Simulate authorization loss
            </button>
          )}
        </StaffWorkspaceAccess>
      </AuthSessionProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Simulate authorization loss" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByRole("heading", { name: "We couldn’t find that page." }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Simulate authorization loss" }),
    ).not.toBeInTheDocument();
  });
});
