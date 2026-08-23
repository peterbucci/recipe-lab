import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { AuthSession } from "../../lib/auth-api";
import { AuthSessionProvider } from "./auth-session-provider";
import { RecipeForkGate } from "./recipe-fork-gate";

const recipeVersionId = "11111111-1111-4111-8111-111111111111";

function renderGate(session: AuthSession) {
  render(
    <AuthSessionProvider initialSession={session}>
      <RecipeForkGate recipeTitle="Carrot Cake" recipeVersionId={recipeVersionId}>
        <form aria-label="Recipe version editor" />
      </RecipeForkGate>
    </AuthSessionProvider>,
  );
}

describe("RecipeForkGate", () => {
  it("keeps the editor out of the signed-out page", () => {
    renderGate({ status: "anonymous" });

    expect(screen.queryByRole("form", { name: /recipe version editor/i })).toBeNull();
    expect(screen.getByRole("heading", { name: /sign in to make this recipe your own/i })).toBeVisible();
    expect(screen.getByRole("link", { name: /sign in to continue/i })).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
    );
  });

  it("requires onboarding before exposing the editor", () => {
    renderGate({
      status: "onboarding_required",
      user: { id: "pending", display_name: "Pending", handle: null },
    });

    expect(screen.queryByRole("form", { name: /recipe version editor/i })).toBeNull();
    expect(screen.getByRole("link", { name: /finish account setup/i })).toHaveAttribute(
      "href",
      `/onboarding?return_to=%2Frecipes%2F${recipeVersionId}%2Ffork`,
    );
  });

  it("renders the editor only for a fully set-up member", () => {
    renderGate({
      status: "authenticated",
      user: { id: "member", display_name: "Member", handle: "member" },
    });

    expect(screen.getByRole("form", { name: /recipe version editor/i })).toBeVisible();
    expect(screen.queryByRole("heading", { name: /sign in/i })).toBeNull();
  });
});
