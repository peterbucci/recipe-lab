import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PublicCookProfilePage } from "../../../lib/recipe-library-api";
import { buildRecipeCardSummary } from "../../../tests/support/builders/recipe";
import CookProfilePage from "./page";

const mocks = vi.hoisted(() => ({
  fetchPublicCookProfile: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

vi.mock("../../../lib/recipe-library-api", () => ({
  fetchPublicCookProfile: mocks.fetchPublicCookProfile,
}));

vi.mock("../../components/cook-profile-view", () => ({
  CookProfileView: ({ data }: { data: PublicCookProfilePage }) => (
    <section aria-label="Cook profile">
      <h1>{data.cook.display_name}</h1>
      <p>Profile page {data.page}</p>
    </section>
  ),
}));

const profile: PublicCookProfilePage = {
  cook: {
    display_name: "Alice Cook",
    handle: "alice",
    id: "77777777-7777-4777-8777-777777777777",
  },
  description: "Practical weeknight recipes.",
  follower_count: 4,
  items: [buildRecipeCardSummary()],
  page: 2,
  page_size: 12,
  total: 13,
  total_pages: 2,
};

describe("CookProfilePage", () => {
  beforeEach(() => {
    mocks.fetchPublicCookProfile.mockReset();
    mocks.notFound.mockClear();
  });

  it("uses the first page query value and renders the resolved public cook", async () => {
    mocks.fetchPublicCookProfile.mockResolvedValue(profile);

    render(
      await CookProfilePage({
        params: Promise.resolve({ handle: "alice" }),
        searchParams: Promise.resolve({ page: ["2", "99"] }),
      }),
    );

    expect(mocks.fetchPublicCookProfile).toHaveBeenCalledWith({
      handle: "alice",
      page: 2,
      pageSize: 12,
    });
    expect(
      screen.getByRole("heading", { name: "Alice Cook", level: 1 }),
    ).toBeVisible();
    expect(screen.getByText("Profile page 2")).toBeVisible();
  });

  it.each([
    { label: "missing", page: undefined },
    { label: "zero", page: "0" },
    { label: "negative", page: "-1" },
    { label: "fractional", page: "1.5" },
    { label: "too large", page: "1000001" },
    { label: "unsafe", page: "9007199254740992" },
  ])("defaults a $label page query to page one", async ({ page }) => {
    mocks.fetchPublicCookProfile.mockResolvedValue(profile);

    await CookProfilePage({
      params: Promise.resolve({ handle: "alice" }),
      searchParams: Promise.resolve({ page }),
    });

    expect(mocks.fetchPublicCookProfile).toHaveBeenCalledWith({
      handle: "alice",
      page: 1,
      pageSize: 12,
    });
  });

  it("rejects an invalid handle before requesting profile data", async () => {
    await expect(
      CookProfilePage({
        params: Promise.resolve({ handle: "invalid handle" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.fetchPublicCookProfile).not.toHaveBeenCalled();
  });

  it("uses the not-found boundary when the cook does not exist", async () => {
    mocks.fetchPublicCookProfile.mockResolvedValue(null);

    await expect(
      CookProfilePage({
        params: Promise.resolve({ handle: "missing-cook" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("not-found");

    expect(mocks.notFound).toHaveBeenCalledOnce();
  });

  it("lets ordinary profile failures reach the route error boundary", async () => {
    mocks.fetchPublicCookProfile.mockRejectedValue(
      new Error("profile service unavailable"),
    );

    await expect(
      CookProfilePage({
        params: Promise.resolve({ handle: "alice" }),
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow("profile service unavailable");

    expect(mocks.notFound).not.toHaveBeenCalled();
  });
});
