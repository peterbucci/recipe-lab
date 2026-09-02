import { describe, expect, it, vi } from "vitest";

import SavedRecipesPage from "./page";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("redirected");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

describe("SavedRecipesPage", () => {
  it("redirects the old saved-library route into the unified My recipes hub", () => {
    expect(() => SavedRecipesPage()).toThrow("redirected");
    expect(mocks.redirect).toHaveBeenCalledWith("/account/recipes?view=saved");
  });
});
