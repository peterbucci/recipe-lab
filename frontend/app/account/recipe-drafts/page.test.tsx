import { describe, expect, it, vi } from "vitest";

import RecipeDraftsPage from "./page";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("redirected");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

describe("RecipeDraftsPage", () => {
  it("redirects only the old collection route to the Drafts view", () => {
    expect(() => RecipeDraftsPage()).toThrow("redirected");
    expect(mocks.redirect).toHaveBeenCalledWith("/account/recipes?view=drafts");
  });
});
