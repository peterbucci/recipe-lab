import { describe, expect, it } from "vitest";

import { MemberRouteGate } from "../../../features/auth/member-route-gate";
import { MyRecipeLibrary } from "../../../features/recipes/library/my-recipe-library";
import { SavedRecipeLibrary } from "../../../features/recipes/library/saved-recipe-library";
import MyRecipesPage from "./page";

describe("MyRecipesPage", () => {
  it("passes the URL-addressable view and page to My recipes", async () => {
    const element = await MyRecipesPage({
      searchParams: Promise.resolve({ view: "withdrawn", page: "3" }),
    });

    expect(element.type).toBe(MemberRouteGate);
    expect(element.props).toMatchObject({
      returnTo: "/account/recipes?view=withdrawn&page=3",
    });
    expect(element.props.children).toMatchObject({
      type: MyRecipeLibrary,
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

    expect(malformed.props).toMatchObject({
      returnTo: "/account/recipes?view=drafts",
    });
    expect(malformed.props.children).toMatchObject({
      type: MyRecipeLibrary,
      props: { view: "drafts", pageNumber: 1 },
    });
    expect(repeated.props).toMatchObject({
      returnTo: "/account/recipes?view=published&page=2",
    });
    expect(repeated.props.children).toMatchObject({
      type: MyRecipeLibrary,
      props: { view: "published", pageNumber: 2 },
    });
  });

  it("composes the Saved gate and URL-owned page directly", async () => {
    const element = await MyRecipesPage({
      searchParams: Promise.resolve({ view: "saved", page: "2" }),
    });

    expect(element.type).toBe(MemberRouteGate);
    expect(element.props).toMatchObject({
      returnTo: "/account/recipes?view=saved&page=2",
      signedOutDescription:
        "Your drafts, saves, and other private recipe activity belong only to your account.",
    });
    expect(element.props.children).toMatchObject({
      type: SavedRecipeLibrary,
      props: { pageNumber: 2 },
    });
  });
});
