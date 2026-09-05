import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../lib/auth-api";
import {
  authenticated,
  cleanupRecipeLibraryViewMocks,
  fork,
  original,
  ROOT_ID,
} from "./recipe-library-views-test-support";
import { SavedRecipeLibrary } from "./saved-recipe-library";
afterEach(cleanupRecipeLibraryViewMocks);

describe("cook profile and private recipe libraries", () => {
  it("lists only the current member’s saved recipes and pages privately", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [{ recipe: fork(), saved_at: "2026-08-25T12:00:00Z" }],
          page: 1,
          page_size: 12,
          total: 13,
          total_pages: 2,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ recipe: original(), saved_at: "2026-08-24T12:00:00Z" }],
          page: 2,
          page_size: 12,
          total: 13,
          total_pages: 2,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<SavedRecipeLibrary />);

    expect(
      screen.getByRole("heading", { level: 1, name: "My recipes" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "Ingredient requests →" }),
    ).toBeNull();
    expect(
      screen.queryByRole("heading", { name: "Ingredient requests" }),
    ).toBeNull();
    expect(
      within(
        screen.getByRole("navigation", { name: "My recipe views" }),
      ).getByRole("link", {
        name: "Saved",
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(
      await screen.findByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Creamy tomato soup");
    const savedHeader = screen
      .getByRole("heading", { level: 2, name: "Saved recipes" })
      .closest("header");
    expect(savedHeader).toHaveClass("workspace-panel-header");
    expect(savedHeader).toHaveTextContent(
      "Recipes you’ve saved to come back to later.",
    );
    expect(savedHeader).toHaveTextContent("13 saved recipes");
    const savedList = screen.getByRole("list", { name: "Saved recipes" });
    const savedCard = within(savedList).getByRole("article", {
      name: "Creamy tomato soup",
    });
    expect(savedCard).toHaveClass(
      "member-recipe-card",
      "member-recipe-card--saved",
    );
    expect(
      savedCard.querySelector(".member-recipe-card__status"),
    ).toHaveTextContent("Version");
    expect(within(savedCard).queryByText("4 servings")).toBeNull();
    expect(
      within(savedCard).getByRole("button", {
        name: "Remove saved Creamy tomato soup",
      }),
    ).toBeVisible();
    expect(savedList).toHaveClass("member-library__grid");
    expect(savedList.closest("main")).toHaveClass(
      "account-workspace-page",
      "account-saved-recipes-page",
    );
    expect(savedList.closest("section")).toHaveClass(
      "member-library__collection",
    );
    const pages = screen.getByRole("navigation", {
      name: "Saved recipe pages",
    });
    expect(within(pages).getByText("Page 1 of 2")).toHaveAttribute(
      "aria-current",
      "page",
    );
    fireEvent.click(within(pages).getByRole("button", { name: "Next →" }));
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeVisible());
    expect(
      screen.getByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Alice’s tomato soup");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/my/saved-recipes?page=2&page_size=12",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("removes a saved recipe from its card and announces the result", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [{ recipe: original(), saved_at: "2026-08-25T12:00:00Z" }],
          page: 1,
          page_size: 12,
          total: 1,
          total_pages: 1,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          recipe_version_id: ROOT_ID,
          saved: false,
          rating: null,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<SavedRecipeLibrary />);

    const list = await screen.findByRole("list", { name: "Saved recipes" });
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Remove saved Alice’s tomato soup",
      }),
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [target, init] = fetchMock.mock.calls[1];
    expect(target).toBe(`/api/recipes/${ROOT_ID}/save`);
    expect(init).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      method: "DELETE",
      redirect: "error",
    });
    const headers = new Headers(init?.headers);
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toEqual(expect.any(String));
    expect(headers.get("X-CSRF-Token")).toBe("csrf-value");
    const completion = await screen.findByRole("status");
    expect(completion).toHaveTextContent(
      "Alice’s tomato soup removed from Saved.",
    );
    await waitFor(() => expect(completion).toHaveFocus());
    expect(
      screen.getByRole("heading", { name: "You have no saved recipes yet." }),
    ).toBeVisible();
  });

  it("keeps a saved card intact when removing it fails", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [{ recipe: original(), saved_at: "2026-08-25T12:00:00Z" }],
          page: 1,
          page_size: 12,
          total: 1,
          total_pages: 1,
        }),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            error: {
              code: "interaction_unavailable",
              message:
                "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
            },
          },
          { status: 503 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<SavedRecipeLibrary />);

    const list = await screen.findByRole("list", { name: "Saved recipes" });
    const remove = within(list).getByRole("button", {
      name: "Remove saved Alice’s tomato soup",
    });
    fireEvent.click(remove);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn’t remove this saved recipe. Your saved list is unchanged.",
    );
    expect(screen.queryByText(/99999999|canonical|uuid|operator|policy/i)).toBeNull();
    expect(
      within(list).getByRole("article", { name: "Alice’s tomato soup" }),
    ).toBeVisible();
    await waitFor(() => expect(remove).toBeEnabled());
  });

  it("offers a useful empty state and a retry without exposing service details", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("private upstream details", { status: 503 }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [],
          page: 1,
          page_size: 12,
          total: 0,
          total_pages: 0,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<SavedRecipeLibrary />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recipe Lab could not load this recipe library.",
    );
    expect(
      screen.queryByText(/private upstream details/i),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh saved recipes" }),
    );
    const emptyHeading = await screen.findByRole("heading", {
      level: 2,
      name: "You have no saved recipes yet.",
    });
    const emptyState = emptyHeading.closest("section");

    expect(emptyHeading).toBeVisible();
    expect(emptyState).not.toBeNull();
    expect(within(emptyState!).getByText("Nothing here yet")).toBeVisible();
    expect(
      within(emptyState!).getByText(
        "Use “Save recipe” on a public recipe to keep it in this private list.",
      ),
    ).toBeVisible();
    expect(
      within(emptyState!).getByRole("link", { name: "Explore recipes" }),
    ).toHaveAttribute("href", "/recipes");
    expect(screen.queryByText("Nothing bookmarked")).not.toBeInTheDocument();
  });

  it("recovers from a stale private-library page without claiming the account is empty", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [{ recipe: original(), saved_at: "2026-08-25T12:00:00Z" }],
          page: 1,
          page_size: 12,
          total: 13,
          total_pages: 2,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [],
          page: 2,
          page_size: 12,
          total: 13,
          total_pages: 1,
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ recipe: original(), saved_at: "2026-08-25T12:00:00Z" }],
          page: 1,
          page_size: 12,
          total: 1,
          total_pages: 1,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<SavedRecipeLibrary />);

    const pages = await screen.findByRole("navigation", {
      name: "Saved recipe pages",
    });
    fireEvent.click(within(pages).getByRole("button", { name: "Next →" }));
    expect(
      await screen.findByRole("heading", {
        name: "That page is beyond your saved recipes.",
      }),
    ).toBeVisible();
    expect(
      screen.queryByText("You have no saved recipes yet."),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Return to the first page" }),
    );
    expect(
      await screen.findByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Alice’s tomato soup");
  });
});
