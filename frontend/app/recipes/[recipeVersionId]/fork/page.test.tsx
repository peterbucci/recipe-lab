import { describe, expect, it, vi } from "vitest";

import RecipeForkPage from "./page";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("not-found");
  }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";

describe("RecipeForkPage", () => {
  it("passes the canonical route ID straight to private draft recovery", async () => {
    const element = await RecipeForkPage({
      params: Promise.resolve({ recipeVersionId: SOURCE_ID.toUpperCase() }),
    });

    expect(element).toMatchObject({
      props: { sourceVersionId: SOURCE_ID },
    });
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("still rejects malformed route identifiers without a public recipe fetch", async () => {
    await expect(
      RecipeForkPage({
        params: Promise.resolve({ recipeVersionId: "not-a-recipe-id" }),
      }),
    ).rejects.toThrow("not-found");
  });
});
