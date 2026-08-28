import { describe, expect, it } from "vitest";

import MyRecipesPage from "./page";

describe("MyRecipesPage", () => {
  it("passes the URL-addressable view and page to My recipes", async () => {
    const element = await MyRecipesPage({
      searchParams: Promise.resolve({ view: "withdrawn", page: "3" }),
    });

    expect(element).toMatchObject({
      props: { view: "withdrawn", pageNumber: 3 },
    });
  });

  it("defaults malformed or repeated values to the safe first Drafts page", async () => {
    const malformed = await MyRecipesPage({
      searchParams: Promise.resolve({ view: "private", page: "0" }),
    });
    const repeated = await MyRecipesPage({
      searchParams: Promise.resolve({ view: ["published", "withdrawn"], page: ["2", "4"] }),
    });

    expect(malformed).toMatchObject({ props: { view: "drafts", pageNumber: 1 } });
    expect(repeated).toMatchObject({ props: { view: "published", pageNumber: 2 } });
  });
});
