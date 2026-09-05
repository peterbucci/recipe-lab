import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CSRF_COOKIE_NAME } from "../../lib/auth-api";
import { deferred } from "../../tests/support/deferred";
import {
  authenticated,
  authenticatedTree,
  cleanupRecipeLibraryViewMocks,
  DRAFT_ID,
  getRecipeLibraryRouterMocks,
  original,
} from "./recipe-library-views-test-support";
import { MyRecipeLibrary } from "./my-recipe-library";

const routerMocks = getRecipeLibraryRouterMocks();
afterEach(cleanupRecipeLibraryViewMocks);

describe("cook profile and private recipe libraries", () => {
  it("discards a private draft from My recipes and stays in the Drafts view", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const draft = {
      id: DRAFT_ID,
      source_version_id: null,
      status: "active",
      revision: 2,
      title: "Soup in progress",
      ingredient_count: 4,
      instruction_count: 3,
      created_at: "2026-08-25T08:00:00Z",
      updated_at: "2026-08-25T12:00:00Z",
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          items: [{ kind: "draft", draft }],
          page: 1,
          page_size: 12,
          total: 1,
          total_pages: 1,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
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
    authenticated(<MyRecipeLibrary pageNumber={1} view="drafts" />);

    const list = await screen.findByRole("list", {
      name: "Private recipe drafts",
    });
    fireEvent.click(within(list).getByRole("button", { name: "Discard" }));
    const confirmation = within(list).getByRole("group", {
      name: "Discard Soup in progress",
    });
    expect(confirmation).toHaveTextContent("cannot be restored");
    fireEvent.click(
      within(confirmation).getByRole("button", { name: "Discard permanently" }),
    );

    const discardPath = `/api/recipe-drafts/${DRAFT_ID}?revision=2`;
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([target]) => target === discardPath),
      ).toBe(true),
    );
    const discardCall = fetchMock.mock.calls.find(
      ([target]) => target === discardPath,
    );
    expect(discardCall?.[1]).toMatchObject({ method: "DELETE" });
    expect(new Headers(discardCall?.[1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-value",
    );
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Soup in progress was permanently discarded.",
    );
    expect(
      screen.getByRole("heading", { name: "You have no private drafts yet." }),
    ).toBeVisible();
    expect(routerMocks.replace).not.toHaveBeenCalled();
  });

  it("returns focus to Discard when a cook keeps a draft", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          items: [
            {
              kind: "draft",
              draft: {
                id: DRAFT_ID,
                source_version_id: null,
                status: "active",
                revision: 2,
                title: "Soup in progress",
                ingredient_count: 4,
                instruction_count: 3,
                created_at: "2026-08-25T08:00:00Z",
                updated_at: "2026-08-25T12:00:00Z",
              },
            },
          ],
          page: 1,
          page_size: 12,
          total: 1,
          total_pages: 1,
        }),
      ),
    );
    authenticated(<MyRecipeLibrary pageNumber={1} view="drafts" />);

    const drafts = await screen.findByRole("list", {
      name: "Private recipe drafts",
    });
    const discard = within(drafts).getByRole("button", { name: "Discard" });
    discard.focus();
    fireEvent.click(discard);
    fireEvent.click(within(drafts).getByRole("button", { name: "Keep draft" }));

    await waitFor(() =>
      expect(
        within(drafts).getByRole("button", { name: "Discard" }),
      ).toHaveFocus(),
    );
  });

  it("keeps the newly selected view stable when an off-view discard finishes", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const deletion = deferred<Response>();
    let draftReads = 0;
    const draft = {
      id: DRAFT_ID,
      source_version_id: null,
      status: "active",
      revision: 2,
      title: "Soup in progress",
      ingredient_count: 4,
      instruction_count: 3,
      created_at: "2026-08-25T08:00:00Z",
      updated_at: "2026-08-25T12:00:00Z",
    };
    const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.includes("/api/my/recipes?view=drafts")) {
        draftReads += 1;
        return Response.json({
          items: [{ kind: "draft", draft }],
          page: 1,
          page_size: 12,
          total: 1,
          total_pages: 1,
        });
      }
      if (url.includes("/api/my/recipes?view=published")) {
        return Response.json({
          items: [
            {
              kind: "published",
              recipe: original(),
              visibility_state: "published",
            },
          ],
          page: 1,
          page_size: 12,
          total: 1,
          total_pages: 1,
        });
      }
      if (
        url === `/api/recipe-drafts/${DRAFT_ID}?revision=2` &&
        init?.method === "DELETE"
      ) {
        return deletion.promise;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = authenticated(
      <MyRecipeLibrary pageNumber={1} view="drafts" />,
    );

    const drafts = await screen.findByRole("list", {
      name: "Private recipe drafts",
    });
    fireEvent.click(within(drafts).getByRole("button", { name: "Discard" }));
    fireEvent.click(
      within(drafts).getByRole("button", { name: "Discard permanently" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/recipe-drafts/${DRAFT_ID}?revision=2`,
        expect.objectContaining({ method: "DELETE" }),
      ),
    );

    rerender(
      authenticatedTree(<MyRecipeLibrary pageNumber={1} view="published" />),
    );
    const published = await screen.findByRole("list", {
      name: "Published recipes",
    });
    const publishedRecipe = within(published).getByRole("link", {
      name: "Alice’s tomato soup",
    });
    publishedRecipe.focus();
    deletion.resolve(new Response(null, { status: 204 }));

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Soup in progress was permanently discarded.",
    );
    await waitFor(() => expect(draftReads).toBe(1));
    expect(within(published).getByRole("article")).toBeVisible();
    expect(publishedRecipe).toHaveFocus();
    expect(screen.queryByText("Loading published recipes…")).toBeNull();
  });

  it("removes a discarded draft locally when revalidation fails", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const draft = {
      id: DRAFT_ID,
      source_version_id: null,
      status: "active",
      revision: 2,
      title: "Soup in progress",
      ingredient_count: 4,
      instruction_count: 3,
      created_at: "2026-08-25T08:00:00Z",
      updated_at: "2026-08-25T12:00:00Z",
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          Response.json({
            items: [{ kind: "draft", draft }],
            page: 1,
            page_size: 12,
            total: 1,
            total_pages: 1,
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "recipe_library_unavailable",
                message: "private details",
              },
            },
            { status: 503 },
          ),
        ),
    );
    authenticated(<MyRecipeLibrary pageNumber={1} view="drafts" />);

    const drafts = await screen.findByRole("list", {
      name: "Private recipe drafts",
    });
    fireEvent.click(within(drafts).getByRole("button", { name: "Discard" }));
    fireEvent.click(
      within(drafts).getByRole("button", { name: "Discard permanently" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Recipe Lab could not load your private drafts. Please try again.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Soup in progress was permanently discarded.",
    );
    expect(
      screen.queryByRole("heading", { name: "Soup in progress" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "You have no private drafts yet." }),
    ).toBeVisible();
  });
});

