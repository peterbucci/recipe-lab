import { beforeEach, describe, expect, it, vi } from "vitest";

import LegacyRecipeDraftPage from "./page";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
  redirect: vi.fn(() => {
    throw new Error("redirected");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

const DRAFT_ID = "11111111-1111-4111-8111-111111111111";

describe("LegacyRecipeDraftPage", () => {
  beforeEach(() => {
    mocks.notFound.mockClear();
    mocks.redirect.mockClear();
  });

  it("keeps old private-draft links working as a canonical workspace alias", async () => {
    await expect(
      LegacyRecipeDraftPage({
        params: Promise.resolve({ draftId: DRAFT_ID.toUpperCase() }),
      }),
    ).rejects.toThrow("redirected");

    expect(mocks.redirect).toHaveBeenCalledWith(`/recipes/drafts/${DRAFT_ID}`);
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("does not redirect malformed legacy draft identifiers", async () => {
    await expect(
      LegacyRecipeDraftPage({
        params: Promise.resolve({ draftId: "not-a-draft-id" }),
      }),
    ).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
});
