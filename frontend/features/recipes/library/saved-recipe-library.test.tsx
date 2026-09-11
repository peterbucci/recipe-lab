import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../../shared/api/browser-session";
import { deferred } from "../../../tests/support/deferred";
import {
  authenticated,
  authenticatedTree,
  cleanupRecipeLibraryViewMocks,
  fork,
  FORK_ID,
  getRecipeLibraryRouterMocks,
  original,
  ROOT_ID,
} from "./recipe-library-test-support";
import { SavedRecipeLibrary } from "./saved-recipe-library";

const FRESH_ID = "88888888-8888-4888-8888-888888888888";
const routerMocks = getRecipeLibraryRouterMocks();
afterEach(cleanupRecipeLibraryViewMocks);

function savedPage(
  recipe: ReturnType<typeof original>,
  page: number,
  total: number,
  totalPages: number,
) {
  return Response.json({
    items: [{ recipe, saved_at: "2026-08-25T12:00:00Z" }],
    page,
    page_size: 12,
    total,
    total_pages: totalPages,
  });
}

function removedRecipe(recipeVersionId: string) {
  return Response.json({
    recipe_version_id: recipeVersionId,
    saved: false,
    rating: null,
  });
}

describe("cook profile and private recipe libraries", () => {
  it("uses URL pages for deep links and back-forward navigation", async () => {
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
      )
      .mockResolvedValueOnce(
        Response.json({
          items: [{ recipe: fork(), saved_at: "2026-08-25T12:00:00Z" }],
          page: 1,
          page_size: 12,
          total: 13,
          total_pages: 2,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = authenticated(<SavedRecipeLibrary pageNumber={1} />);

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
    expect(within(pages).getByRole("link", { name: "Next →" })).toHaveAttribute(
      "href",
      "/account/recipes?view=saved&page=2",
    );
    rerender(authenticatedTree(<SavedRecipeLibrary pageNumber={2} />));
    await waitFor(() => expect(screen.getByText("Page 2 of 2")).toBeVisible());
    expect(
      screen.getByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Alice’s tomato soup");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/my/saved-recipes?page=2&page_size=12",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(
      within(
        screen.getByRole("navigation", { name: "Saved recipe pages" }),
      ).getByRole("link", { name: "← Previous" }),
    ).toHaveAttribute("href", "/account/recipes?view=saved");

    rerender(authenticatedTree(<SavedRecipeLibrary pageNumber={1} />));
    expect(
      await screen.findByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Creamy tomato soup");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/my/saved-recipes?page=1&page_size=12",
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
    authenticated(<SavedRecipeLibrary pageNumber={1} />);

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

  it("returns to the previous URL page after removing its current last item", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(savedPage(original(), 2, 13, 2))
      .mockResolvedValueOnce(removedRecipe(ROOT_ID))
      .mockResolvedValueOnce(savedPage(fork(), 1, 12, 1));
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = authenticated(
      <SavedRecipeLibrary pageNumber={2} />,
    );

    const list = await screen.findByRole("list", { name: "Saved recipes" });
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Remove saved Alice’s tomato soup",
      }),
    );

    await waitFor(() =>
      expect(routerMocks.replace).toHaveBeenCalledWith(
        "/account/recipes?view=saved",
      ),
    );
    rerender(authenticatedTree(<SavedRecipeLibrary pageNumber={1} />));

    expect(
      await screen.findByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Creamy tomato soup");
    const completion = screen.getByRole("status");
    expect(completion).toHaveTextContent(
      "Alice’s tomato soup removed from Saved.",
    );
    await waitFor(() => expect(completion).toHaveFocus());
  });

  it("refreshes the current page when an off-page removal succeeds", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const removal = deferred<Response>();
    let pageOneReads = 0;
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/my/saved-recipes?page=2&page_size=12") {
        return savedPage(original(), 2, 13, 2);
      }
      if (url === "/api/my/saved-recipes?page=1&page_size=12") {
        pageOneReads += 1;
        return savedPage(fork(), 1, 12, 1);
      }
      if (url === `/api/recipes/${ROOT_ID}/save` && init?.method === "DELETE") {
        return removal.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = authenticated(
      <SavedRecipeLibrary pageNumber={2} />,
    );

    const pageTwo = await screen.findByRole("list", { name: "Saved recipes" });
    fireEvent.click(
      within(pageTwo).getByRole("button", {
        name: "Remove saved Alice’s tomato soup",
      }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/recipes/${ROOT_ID}/save`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );

    rerender(authenticatedTree(<SavedRecipeLibrary pageNumber={1} />));
    const pageOne = await screen.findByRole("list", { name: "Saved recipes" });
    const currentRecipe = within(pageOne).getByRole("link", {
      name: "Creamy tomato soup",
    });
    currentRecipe.focus();
    await act(async () => removal.resolve(removedRecipe(ROOT_ID)));

    await waitFor(() => expect(pageOneReads).toBe(2));
    expect(
      screen.getByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Creamy tomato soup");
    expect(
      screen.getByRole("heading", { level: 2, name: "Saved recipes" })
        .closest("header"),
    ).toHaveTextContent("12 saved recipes");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(currentRecipe).toHaveFocus();
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it("keeps a newer removal pending when an off-page attempt rejects", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const oldRemoval = deferred<Response>();
    const currentRemoval = deferred<Response>();
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/my/saved-recipes?page=2&page_size=12") {
        return savedPage(original(), 2, 13, 2);
      }
      if (url === "/api/my/saved-recipes?page=1&page_size=12") {
        return savedPage(fork(), 1, 12, 1);
      }
      if (init?.method === "DELETE" && url === `/api/recipes/${ROOT_ID}/save`) {
        return oldRemoval.promise;
      }
      if (init?.method === "DELETE" && url === `/api/recipes/${FORK_ID}/save`) {
        return currentRemoval.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = authenticated(
      <SavedRecipeLibrary pageNumber={2} />,
    );

    fireEvent.click(
      within(await screen.findByRole("list", { name: "Saved recipes" })).getByRole(
        "button",
        { name: "Remove saved Alice’s tomato soup" },
      ),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/recipes/${ROOT_ID}/save`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    rerender(authenticatedTree(<SavedRecipeLibrary pageNumber={1} />));
    const currentPage = await screen.findByRole("list", {
      name: "Saved recipes",
    });
    fireEvent.click(
      within(currentPage).getByRole("button", {
        name: "Remove saved Creamy tomato soup",
      }),
    );
    await screen.findByRole("button", {
      name: "Removing saved Creamy tomato soup…",
    });
    const currentRecipe = within(currentPage).getByRole("link", {
      name: "Creamy tomato soup",
    });
    currentRecipe.focus();

    await act(async () => oldRemoval.reject(new Error("old request failed")));

    expect(
      screen.getByRole("button", {
        name: "Removing saved Creamy tomato soup…",
      }),
    ).toBeDisabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(currentRecipe).toHaveFocus();

    await act(async () => currentRemoval.resolve(removedRecipe(FORK_ID)));
    const completion = await screen.findByRole("status");
    expect(completion).toHaveTextContent(
      "Creamy tomato soup removed from Saved.",
    );
    await waitFor(() => expect(completion).toHaveFocus());
  });

  it("does not apply an old page result after returning to a newer snapshot", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const removal = deferred<Response>();
    let pageTwoReads = 0;
    const freshRecipe = original({
      id: FRESH_ID,
      title: "Fresh page two recipe",
    });
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url === "/api/my/saved-recipes?page=1&page_size=12") {
        return savedPage(fork(), 1, 12, 1);
      }
      if (url === "/api/my/saved-recipes?page=2&page_size=12") {
        pageTwoReads += 1;
        if (pageTwoReads === 1) return savedPage(original(), 2, 13, 2);
        if (pageTwoReads === 2) return savedPage(original(), 2, 25, 3);
        return savedPage(freshRecipe, 2, 24, 2);
      }
      if (url === `/api/recipes/${ROOT_ID}/save` && init?.method === "DELETE") {
        return removal.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = authenticated(
      <SavedRecipeLibrary pageNumber={2} />,
    );

    fireEvent.click(
      within(await screen.findByRole("list", { name: "Saved recipes" })).getByRole(
        "button",
        { name: "Remove saved Alice’s tomato soup" },
      ),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/recipes/${ROOT_ID}/save`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );
    rerender(authenticatedTree(<SavedRecipeLibrary pageNumber={1} />));
    expect(
      await screen.findByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Creamy tomato soup");
    rerender(authenticatedTree(<SavedRecipeLibrary pageNumber={2} />));
    expect(
      await screen.findByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Alice’s tomato soup");

    await act(async () => removal.resolve(removedRecipe(ROOT_ID)));

    await waitFor(() => expect(pageTwoReads).toBe(3));
    expect(
      screen.getByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Fresh page two recipe");
    expect(
      screen.getByRole("heading", { level: 2, name: "Saved recipes" })
        .closest("header"),
    ).toHaveTextContent("24 saved recipes");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it.each(["resolves", "rejects"] as const)(
    "ignores a pending removal that %s after its component lifetime ends",
    async (outcome) => {
      document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
      const removal = deferred<Response>();
      let pageOneReads = 0;
      let pageTwoReads = 0;
      const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
        const url = String(input);
        if (url === "/api/my/saved-recipes?page=2&page_size=12") {
          pageTwoReads += 1;
          return savedPage(original(), 2, 13, 2);
        }
        if (url === "/api/my/saved-recipes?page=1&page_size=12") {
          pageOneReads += 1;
          return savedPage(fork(), 1, 12, 1);
        }
        if (
          url === `/api/recipes/${ROOT_ID}/save` &&
          init?.method === "DELETE"
        ) {
          return removal.promise;
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      const oldView = authenticated(<SavedRecipeLibrary pageNumber={2} />);

      fireEvent.click(
        within(
          await screen.findByRole("list", { name: "Saved recipes" }),
        ).getByRole("button", {
          name: "Remove saved Alice’s tomato soup",
        }),
      );
      await waitFor(() =>
        expect(fetchMock).toHaveBeenCalledWith(
          `/api/recipes/${ROOT_ID}/save`,
          expect.objectContaining({ method: "DELETE" }),
        ),
      );

      oldView.unmount();
      authenticated(<SavedRecipeLibrary pageNumber={1} />);
      const currentPage = await screen.findByRole("list", {
        name: "Saved recipes",
      });
      const currentRecipe = within(currentPage).getByRole("link", {
        name: "Creamy tomato soup",
      });
      currentRecipe.focus();

      await act(async () => {
        if (outcome === "resolves") {
          removal.resolve(removedRecipe(ROOT_ID));
        } else {
          removal.reject(new Error("old request failed"));
        }
      });

      expect(pageOneReads).toBe(1);
      expect(pageTwoReads).toBe(1);
      expect(currentPage).toHaveTextContent("Creamy tomato soup");
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(currentRecipe).toHaveFocus();
      expect(routerMocks.replace).not.toHaveBeenCalled();
    },
  );

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
      )
      .mockResolvedValueOnce(removedRecipe(ROOT_ID));
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<SavedRecipeLibrary pageNumber={1} />);

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

    const firstIdempotencyKey = new Headers(
      fetchMock.mock.calls[1]?.[1]?.headers,
    ).get("Idempotency-Key");
    fireEvent.click(remove);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(
      new Headers(fetchMock.mock.calls[2]?.[1]?.headers).get(
        "Idempotency-Key",
      ),
    ).toBe(firstIdempotencyKey);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Alice’s tomato soup removed from Saved.",
    );
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
    authenticated(<SavedRecipeLibrary pageNumber={1} />);

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
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      Response.json({
        items: [],
        page: 2,
        page_size: 12,
        total: 13,
        total_pages: 1,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<SavedRecipeLibrary pageNumber={2} />);

    expect(
      await screen.findByRole("heading", {
        name: "That page is beyond your saved recipes.",
      }),
    ).toBeVisible();
    expect(
      screen.queryByText("You have no saved recipes yet."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Page out of range")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("navigation", { name: "Saved recipe pages" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Return to the first page" }),
    ).toHaveAttribute("href", "/account/recipes?view=saved");
  });
});
