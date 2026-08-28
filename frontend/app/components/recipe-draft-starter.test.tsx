import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AuthSessionProvider } from "./auth-session-provider";
import { NavigationBlockerProvider } from "./navigation-blocker-provider";
import { RecipeDraftStarter } from "./recipe-draft-starter";

const mocks = vi.hoisted(() => ({
  createRecipeDraft: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("../../lib/recipe-draft-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/recipe-draft-api")>();
  return { ...actual, createRecipeDraft: mocks.createRecipeDraft };
});

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";

function renderStarter(status: "anonymous" | "authenticated") {
  render(
    <NavigationBlockerProvider>
      <AuthSessionProvider
        initialSession={
          status === "anonymous"
            ? { status: "anonymous" }
            : {
                status: "authenticated",
                user: { id: "member", display_name: "Member", handle: "member" },
              }
        }
      >
        <RecipeDraftStarter recipeTitle="Tomato Soup" sourceVersionId={SOURCE_ID} />
      </AuthSessionProvider>
    </NavigationBlockerProvider>,
  );
}

describe("RecipeDraftStarter", () => {
  beforeEach(() => {
    mocks.createRecipeDraft.mockReset();
    mocks.replace.mockReset();
  });

  it("keeps draft creation behind a member session", () => {
    renderStarter("anonymous");
    expect(screen.getByRole("heading", { name: "Sign in to work on private recipes" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in to continue" })).toHaveAttribute(
      "href",
      `/sign-in?return_to=%2Frecipes%2F${SOURCE_ID}%2Ffork`,
    );
    expect(screen.queryByRole("button", { name: "Create private draft" })).toBeNull();
  });

  it("creates an exact-source draft and replaces the starter route", async () => {
    mocks.createRecipeDraft.mockResolvedValue({ id: DRAFT_ID });
    renderStarter("authenticated");

    expect(screen.getByText(/will not appear in search, activity, or public recipe pages/i)).toBeVisible();
    expect(screen.queryByText(/recommend/i)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create private draft" }));

    await waitFor(() => expect(mocks.createRecipeDraft).toHaveBeenCalledWith(SOURCE_ID));
    expect(mocks.replace).toHaveBeenCalledWith(`/account/recipe-drafts/${DRAFT_ID}`);
  });
});
