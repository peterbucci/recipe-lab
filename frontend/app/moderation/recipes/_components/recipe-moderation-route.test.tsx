import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "../../../../features/auth/auth-session-provider";
import { RecipeModerationRoute } from "./recipe-moderation-route";

const mocks = vi.hoisted(() => ({
  browse: vi.fn(),
}));

vi.mock("../../../../features/moderation/review/recipe-moderation-api", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../../features/moderation/review/recipe-moderation-api")
  >();
  return {
    ...actual,
    browseRecipeModerationCases: mocks.browse,
  };
});

describe("RecipeModerationRoute", () => {
  it("does not reveal the workspace to ordinary members", () => {
    render(
      <AuthSessionProvider
        initialSession={{
          status: "authenticated",
          user: { id: "member-id", handle: "member", display_name: "Member" },
          capabilities: { review_ingredient_requests: false, moderate_recipe_reports: false },
        }}
      >
        <RecipeModerationRoute />
      </AuthSessionProvider>,
    );

    expect(screen.getByRole("main")).toHaveClass(
      "staff-state-page",
      "staff-state-page--moderation",
      "staff-state-page--authorization",
    );
    expect(screen.getByRole("alert")).toHaveClass("staff-state-panel");
    expect(screen.getByRole("heading", { name: "We couldn’t find that page." })).toBeVisible();
    expect(screen.queryByText("Page unavailable")).not.toBeInTheDocument();
    expect(screen.queryByText(/moderator/i)).not.toBeInTheDocument();
    expect(mocks.browse).not.toHaveBeenCalled();
  });
});
