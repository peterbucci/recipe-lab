import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../../../features/auth/auth-session-provider";
import { IngredientRequestsRoute } from "./ingredient-requests-route";

const mocks = vi.hoisted(() => ({ workspace: vi.fn() }));

vi.mock(
  "../../../../features/ingredients/requests/my-ingredient-requests-workspace",
  () => ({
    MyIngredientRequestsWorkspace: () => {
      mocks.workspace();
      return (
        <section aria-label="My ingredient requests">
          Member request history
        </section>
      );
    },
  }),
);

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.workspace.mockReset();
});

describe("IngredientRequestsRoute", () => {
  it("keeps anonymous request history private and preserves the return destination", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <IngredientRequestsRoute />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Page Unavailable" }),
    ).toBeVisible();
    expect(screen.getByText("Please sign in to continue")).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign In" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Faccount%2Fingredient-requests",
    );
    expect(screen.getByRole("main")).toHaveClass(
      "account-workspace-page",
      "account-ingredient-requests-page",
    );
    expect(
      screen.queryByRole("region", { name: "My ingredient requests" }),
    ).not.toBeInTheDocument();
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("sends an unfinished member through onboarding before showing history", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "onboarding_required",
          user: { id: "cook-id", display_name: "Alice Cook", handle: null },
        }}
      >
        <IngredientRequestsRoute />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Finish setting up your account" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Finish account setup" }),
    ).toHaveAttribute(
      "href",
      "/onboarding?return_to=%2Faccount%2Fingredient-requests",
    );
    expect(mocks.workspace).not.toHaveBeenCalled();
  });

  it("renders a retryable account-service error before mounting the workspace", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthSessionProvider>
        <IngredientRequestsRoute />
      </AuthSessionProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn’t check your account");
    expect(mocks.workspace).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "Page Unavailable" }),
      ).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.workspace).not.toHaveBeenCalled();
  });
});
