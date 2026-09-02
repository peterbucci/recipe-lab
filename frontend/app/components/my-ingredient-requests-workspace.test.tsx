import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "./auth-session-provider";
import { MyIngredientRequestsWorkspace } from "./my-ingredient-requests-workspace";

vi.mock("./member-ingredient-request-history", () => ({
  MemberIngredientRequestHistory: () => (
    <section aria-label="My ingredient requests">Member request history</section>
  ),
}));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MyIngredientRequestsWorkspace", () => {
  it("keeps anonymous request history private and preserves the return destination", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <MyIngredientRequestsWorkspace />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Sign in to see your requests." }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Faccount%2Fingredient-requests",
    );
    expect(screen.getByRole("main")).toHaveClass(
      "account-workspace-page",
      "account-ingredient-requests-page",
    );
    expect(screen.queryByRole("region", { name: "My ingredient requests" })).not.toBeInTheDocument();
  });

  it("sends an unfinished member through onboarding before showing history", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "onboarding_required",
          user: { id: "cook-id", display_name: "Alice Cook", handle: null },
        }}
      >
        <MyIngredientRequestsWorkspace />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Finish setting up your account." }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Finish account setup" })).toHaveAttribute(
      "href",
      "/onboarding?return_to=%2Faccount%2Fingredient-requests",
    );
  });

  it("shows authenticated members their view-only request history", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        <MyIngredientRequestsWorkspace />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Ingredient Requests" })).toBeVisible();
    expect(
      screen.getByText("Track ingredients you've asked Recipe Lab to add to the catalog."),
    ).toBeVisible();
    expect(screen.queryByText("Catalog requests")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Back to My Recipes/ })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "My ingredient requests" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveClass(
      "account-workspace-page",
      "account-ingredient-requests-page",
    );
    expect(screen.queryByRole("button", { name: /^Use / })).not.toBeInTheDocument();
  });

  it("opens the missing-ingredient request dialog from the page header", async () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "cook-id", display_name: "Alice Cook", handle: "alice" },
        }}
      >
        <MyIngredientRequestsWorkspace />
      </AuthSessionProvider>,
    );

    const trigger = screen.getByRole("button", { name: "Request an ingredient" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute(
      "aria-controls",
      "account-new-ingredient-request-request-dialog",
    );

    fireEvent.click(trigger);

    expect(
      await screen.findByRole("dialog", { name: "Request a missing ingredient" }),
    ).toBeVisible();
    expect(screen.queryByText("Ingredient catalog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Proposed ingredient name" })).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Close ingredient request dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("renders a retryable account-service error before any history request", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ status: "anonymous" }));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <AuthSessionProvider>
        <MyIngredientRequestsWorkspace />
      </AuthSessionProvider>,
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn’t check your account.");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Sign in to see your requests." })).toBeVisible(),
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
