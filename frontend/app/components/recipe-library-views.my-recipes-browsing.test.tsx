import { screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  authenticated,
  cleanupRecipeLibraryViewMocks,
  DRAFT_ID,
  fork,
  FORK_ID,
  ORIGINAL_DRAFT_ID,
  ROOT_ID,
} from "./recipe-library-views-test-support";
import { MyRecipeLibrary } from "./my-recipe-library";
afterEach(cleanupRecipeLibraryViewMocks);

describe("cook profile and private recipe libraries", () => {
  it("labels version and original drafts while showing source names only for versions", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [
          {
            kind: "draft",
            source_recipe_title: "Catalog tomato soup",
            description: "A silky tomato soup with a bright basil finish.",
            draft: {
              id: DRAFT_ID,
              source_version_id: ROOT_ID,
              status: "active",
              revision: 2,
              title: "Soup in progress",
              ingredient_count: 4,
              instruction_count: 3,
              created_at: "2026-08-25T08:00:00Z",
              updated_at: "2026-08-25T12:00:00Z",
            },
          },
          {
            kind: "draft",
            source_recipe_title: null,
            description: null,
            draft: {
              id: ORIGINAL_DRAFT_ID,
              source_version_id: null,
              status: "active",
              revision: 1,
              title: "Original soup in progress",
              ingredient_count: 2,
              instruction_count: 1,
              created_at: "2026-08-25T09:00:00Z",
              updated_at: "2026-08-25T11:00:00Z",
            },
          },
        ],
        page: 1,
        page_size: 12,
        total: 2,
        total_pages: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<MyRecipeLibrary pageNumber={1} view="drafts" />);

    const views = screen.getByRole("navigation", { name: "My recipe views" });
    expect(within(views).getByRole("link", { name: "Drafts" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(views).getByRole("link", { name: "Published" }),
    ).toHaveAttribute("href", "/account/recipes?view=published");
    expect(within(views).getByRole("link", { name: "Saved" })).toHaveAttribute(
      "href",
      "/account/recipes?view=saved",
    );
    expect(
      within(views).getByRole("link", { name: "Withdrawn" }),
    ).toHaveAttribute("href", "/account/recipes?view=withdrawn");
    expect(
      screen.queryByRole("link", { name: "Ingredient requests →" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Ingredient requests" }),
    ).toBeNull();
    const list = await screen.findByRole("list", {
      name: "Private recipe drafts",
    });
    const draftsHeader = screen
      .getByRole("heading", { level: 2, name: "Private drafts" })
      .closest("header");
    expect(draftsHeader).toHaveClass("workspace-panel-header");
    expect(draftsHeader).toHaveTextContent(
      "Only you can see these drafts. They never appear in public recipes or search.",
    );
    expect(draftsHeader).toHaveTextContent("2 drafts");
    const workspace = list.closest("main");
    expect(workspace).toHaveClass(
      "account-workspace-page",
      "account-recipes-page",
    );
    expect(list.closest("section")).toHaveClass("member-library__collection");

    const versionCard = within(list).getByRole("article", {
      name: "Soup in progress",
    });
    expect(versionCard).toHaveClass(
      "member-recipe-card",
      "member-recipe-card--draft",
    );
    expect(
      within(versionCard).getByText("Version", { exact: true }),
    ).toBeVisible();
    expect(within(versionCard).getByText(/based on/i)).toHaveTextContent(
      "Based on Catalog tomato soup",
    );
    expect(
      within(versionCard).getByRole("link", {
        name: "Catalog tomato soup",
      }),
    ).toHaveAttribute("href", `/recipes/${ROOT_ID}`);
    expect(within(versionCard).queryByText("a public recipe")).toBeNull();
    expect(
      within(versionCard).queryByRole("link", { name: "View source" }),
    ).toBeNull();
    expect(
      within(versionCard).getByRole("link", { name: "Continue editing" }),
    ).toHaveAttribute("href", `/recipes/drafts/${DRAFT_ID}`);
    expect(versionCard).toHaveTextContent(
      "A silky tomato soup with a bright basil finish.",
    );
    expect(versionCard).not.toHaveTextContent("4 ingredients");
    expect(versionCard).not.toHaveTextContent("3 steps");
    expect(versionCard).toHaveTextContent(/Edited/);

    const originalCard = within(list).getByRole("article", {
      name: "Original soup in progress",
    });
    expect(
      within(originalCard).getByText("Original", { exact: true }),
    ).toBeVisible();
    expect(
      originalCard.querySelector(".member-library__draft-origin"),
    ).toBeNull();
    expect(within(originalCard).queryByText(/original recipe/i)).toBeNull();
    expect(
      within(originalCard).queryByRole("link", { name: "View source" }),
    ).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/my/recipes?view=drafts&page=1&page_size=12",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("pages a Published view through URL links without client-side filtering", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          items: [
            {
              kind: "published",
              recipe: fork(),
              visibility_state: "published",
            },
          ],
          page: 2,
          page_size: 12,
          total: 25,
          total_pages: 3,
        }),
      ),
    );
    authenticated(<MyRecipeLibrary pageNumber={2} view="published" />);

    const list = await screen.findByRole("list", { name: "Published recipes" });
    const publishedHeader = screen
      .getByRole("heading", { level: 2, name: "Published recipes" })
      .closest("header");
    expect(publishedHeader).toHaveClass("workspace-panel-header");
    expect(publishedHeader).toHaveTextContent(
      "These recipes have been published. A recipe hidden by moderation remains visible to you here with its current status.",
    );
    expect(publishedHeader).toHaveTextContent("25 published recipes");
    const publishedCard = within(list).getByRole("article", {
      name: "Creamy tomato soup",
    });
    expect(publishedCard).toHaveClass(
      "member-recipe-card",
      "member-recipe-card--published",
    );
    expect(
      within(publishedCard).getByText("Version", { exact: true }),
    ).toBeVisible();
    expect(within(publishedCard).queryByText("4 servings")).toBeNull();
    expect(
      within(publishedCard).getByRole("link", { name: "View recipe" }),
    ).toHaveAttribute("href", `/recipes/${FORK_ID}`);
    expect(
      within(list).getByRole("link", { name: "Creamy tomato soup" }),
    ).toBeVisible();
    expect(
      within(list).getByText("Based on", { exact: false }).closest("p"),
    ).toHaveTextContent("Based on Catalog tomato soup by Recipe Lab catalog");
    const views = screen.getByRole("navigation", { name: "My recipe views" });
    expect(
      within(views).getByRole("link", { name: "Published" }),
    ).toHaveAttribute("aria-current", "page");
    const pages = screen.getByRole("navigation", {
      name: "Published recipe pages",
    });
    expect(
      within(pages).getByRole("link", { name: "← Previous" }),
    ).toHaveAttribute("href", "/account/recipes?view=published");
    expect(within(pages).getByRole("link", { name: "Next →" })).toHaveAttribute(
      "href",
      "/account/recipes?view=published&page=3",
    );
  });

  it("keeps My recipes errors cook-facing when the service returns private details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "recipe_library_unavailable",
              message:
                "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
            },
          },
          { status: 503 },
        ),
      ),
    );
    authenticated(<MyRecipeLibrary pageNumber={1} view="drafts" />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recipe Lab could not load your private drafts. Please try again.",
    );
    expect(
      screen.queryByText(/99999999|canonical|uuid|operator|policy/i),
    ).toBeNull();
  });

  it.each([
    [
      "drafts",
      "You have no private drafts yet.",
      "Start an original recipe, or make your own version of a public recipe.",
      "Start a new recipe",
    ],
    [
      "published",
      "You have no published recipes yet.",
      "Publish a private draft when it is ready to share.",
      null,
    ],
    [
      "withdrawn",
      "You have no withdrawn recipes.",
      "Recipes you withdraw from public view will stay available to you here.",
      null,
    ],
  ] as const)(
    "shows a useful empty state for the %s view",
    async (view, heading, description, actionLabel) => {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            items: [],
            page: 1,
            page_size: 12,
            total: 0,
            total_pages: 0,
          }),
        ),
      );
      authenticated(<MyRecipeLibrary pageNumber={1} view={view} />);

      const emptyHeading = await screen.findByRole("heading", {
        level: 2,
        name: heading,
      });
      const emptyState = emptyHeading.closest("section");

      expect(emptyHeading).toBeVisible();
      expect(emptyState).not.toBeNull();
      expect(within(emptyState!).getByText("Nothing here yet")).toBeVisible();
      expect(within(emptyState!).getByText(description)).toBeVisible();
      if (actionLabel) {
        expect(
          within(emptyState!).getByRole("link", { name: actionLabel }),
        ).toHaveAttribute("href", "/recipes/new");
      } else {
        expect(within(emptyState!).queryByRole("link")).not.toBeInTheDocument();
      }
    },
  );

  it("recovers from a stale URL page within the selected view", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          items: [],
          page: 3,
          page_size: 12,
          total: 13,
          total_pages: 2,
        }),
      ),
    );
    authenticated(<MyRecipeLibrary pageNumber={3} view="withdrawn" />);

    expect(
      await screen.findByRole("heading", {
        name: "That page is beyond your withdrawn recipes.",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Return to the first page" }),
    ).toHaveAttribute("href", "/account/recipes?view=withdrawn");
  });
});
