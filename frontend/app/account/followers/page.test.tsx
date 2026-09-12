import { describe, expect, it, vi } from "vitest";

import AccountFollowersPage from "./page";

const mocks = vi.hoisted(() => ({
  redirect: vi.fn(() => {
    throw new Error("redirected");
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

describe("AccountFollowersPage", () => {
  it("redirects the former follower route to the Followers view", () => {
    expect(() => AccountFollowersPage()).toThrow("redirected");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/account/connections?view=followers",
    );
  });
});
