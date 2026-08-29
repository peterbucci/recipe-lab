import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicCookProfilePage } from "../../lib/recipe-library-api";
import type { RecipeSummary } from "../../lib/recipe-api";
import { CSRF_COOKIE_NAME } from "../../lib/auth-api";
import CookProfileError from "../cooks/[handle]/error";
import CookProfileLoading from "../cooks/[handle]/loading";
import CookProfileNotFound from "../cooks/[handle]/not-found";
import { AuthSessionProvider } from "./auth-session-provider";
import { CookProfileView } from "./cook-profile-view";
import { MyRecipeLibrary } from "./my-recipe-library";
import { SavedRecipeLibrary } from "./saved-recipe-library";

const routerMocks = vi.hoisted(() => ({ replace: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMocks,
}));

const ALICE_ID = "11111111-1111-4111-8111-111111111111";
const CATALOG_ID = "22222222-2222-4222-8222-222222222222";
const ROOT_ID = "33333333-3333-4333-8333-333333333333";
const FORK_ID = "44444444-4444-4444-8444-444444444444";
const LINEAGE_ID = "55555555-5555-4555-8555-555555555555";
const DRAFT_ID = "66666666-6666-4666-8666-666666666666";

const alice = { id: ALICE_ID, handle: "alice", display_name: "Alice Cook" };
const catalog = {
  id: CATALOG_ID,
  handle: "recipe-lab",
  display_name: "Recipe Lab catalog",
};

function original(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: ROOT_ID,
    lineage_id: LINEAGE_ID,
    parent_version_id: null,
    version_number: 1,
    title: "Alice’s tomato soup",
    description: "A bright soup.",
    servings: "4.00",
    created_at: "2026-08-25T10:00:00Z",
    author: alice,
    parent: null,
    ...overrides,
  };
}

function fork(): RecipeSummary {
  return original({
    id: FORK_ID,
    parent_version_id: ROOT_ID,
    version_number: 2,
    title: "Creamy tomato soup",
    parent: {
      id: ROOT_ID,
      version_number: 1,
      title: "Catalog tomato soup",
      author: catalog,
    },
  });
}

function profile(
  overrides: Partial<PublicCookProfilePage> = {},
): PublicCookProfilePage {
  return {
    cook: alice,
    items: [original(), fork()],
    page: 1,
    page_size: 12,
    total: 13,
    total_pages: 2,
    ...overrides,
  };
}

function authenticatedTree(children: React.ReactNode) {
  return (
    <AuthSessionProvider
      initialSession={{ status: "authenticated", user: alice }}
    >
      {children}
    </AuthSessionProvider>
  );
}

function authenticated(children: React.ReactNode) {
  return render(authenticatedTree(children));
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

afterEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  routerMocks.replace.mockReset();
  vi.unstubAllGlobals();
});

describe("cook profile and private recipe libraries", () => {
  it("renders a public cook heading, bounded authorship, parent context, and links", () => {
    render(<CookProfileView data={profile()} />);

    expect(
      screen.getByRole("heading", { name: "Alice Cook", level: 1 }),
    ).toBeVisible();
    expect(screen.getByText("@alice", { exact: true })).toBeVisible();
    const list = screen.getByRole("list", {
      name: "Public recipes by Alice Cook",
    });
    expect(within(list).getAllByRole("article")).toHaveLength(2);
    expect(
      within(list).getAllByRole("link", { name: "Alice Cook" })[0],
    ).toHaveAttribute("href", "/cooks/alice");
    expect(within(list).queryByText(/^version \d+$/i)).not.toBeInTheDocument();
    expect(within(list).getAllByText("4 servings")).toHaveLength(2);
    expect(within(list).getByText(/based on/i)).toHaveTextContent(
      "Based on Catalog tomato soup by Recipe Lab catalog",
    );
    const pages = screen.getByRole("navigation", {
      name: "Recipe pages for Alice Cook",
    });
    expect(within(pages).getByText("Page 1 of 2")).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(pages).getByRole("link", { name: "Next →" })).toHaveAttribute(
      "href",
      "/cooks/alice?page=2",
    );
  });

  it("treats a cook with no public recipes as a valid empty profile", () => {
    render(
      <CookProfileView
        data={profile({ items: [], total: 0, total_pages: 0 })}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Alice Cook", level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "No public recipes yet." }),
    ).toBeVisible();
    expect(
      screen.queryByRole("list", { name: /public recipes by/i }),
    ).not.toBeInTheDocument();
  });

  it("announces public-profile loading, failure, retry, and missing states", () => {
    const reset = vi.fn();
    const { rerender } = render(<CookProfileLoading />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading this cook’s public recipes.",
    );

    rerender(<CookProfileError reset={reset} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn’t load this cook’s profile.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();

    rerender(<CookProfileNotFound />);
    expect(
      screen.getByRole("heading", { name: "We couldn’t find that cook." }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Browse recipes" }),
    ).toHaveAttribute("href", "/recipes");
  });

  it("lists private drafts without Original or Version labels and links every server view", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        items: [
          {
            kind: "draft",
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
        ],
        page: 1,
        page_size: 12,
        total: 1,
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
    expect(
      within(views).getByRole("link", { name: "Withdrawn" }),
    ).toHaveAttribute("href", "/account/recipes?view=withdrawn");
    const list = await screen.findByRole("list", {
      name: "Private recipe drafts",
    });
    expect(
      within(list).getByText("Private draft", { exact: true }),
    ).toBeVisible();
    expect(within(list).queryByText(/original|version draft/i)).toBeNull();
    expect(
      within(list).getByRole("link", { name: "Resume draft" }),
    ).toHaveAttribute("href", `/account/recipe-drafts/${DRAFT_ID}`);
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

  it("renders Deleted cook and an unavailable source without profile or source links", () => {
    render(
      <CookProfileView
        data={profile({
          items: [
            original({
              author: {
                id: CATALOG_ID,
                handle: null,
                display_name: "Deleted cook",
              },
              parent_version_id: FORK_ID,
              parent: null,
            }),
          ],
          total: 1,
          total_pages: 1,
        })}
      />,
    );

    const list = screen.getByRole("list", {
      name: "Public recipes by Alice Cook",
    });
    expect(
      within(list).getByText("Deleted cook", { exact: true }),
    ).toBeVisible();
    expect(
      within(list).queryByRole("link", { name: "Deleted cook" }),
    ).toBeNull();
    expect(
      within(list).getByText("Source unavailable", { exact: true }),
    ).toBeVisible();
  });

  it("moves a withdrawn recipe out of Published and keeps the success announcement", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const publicPage = {
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
    };
    const emptyPublishedPage = {
      items: [],
      page: 1,
      page_size: 12,
      total: 0,
      total_pages: 0,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(publicPage))
      .mockResolvedValueOnce(
        Response.json({
          recipe_version_id: ROOT_ID,
          state: "author_withdrawn",
          updated_at: "2026-08-25T13:00:00Z",
        }),
      )
      .mockResolvedValueOnce(Response.json(emptyPublishedPage));
    vi.stubGlobal("fetch", fetchMock);
    authenticated(<MyRecipeLibrary pageNumber={1} view="published" />);

    const list = await screen.findByRole("list", { name: "Published recipes" });
    expect(
      within(list).getByRole("link", { name: "Alice’s tomato soup" }),
    ).toBeVisible();
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Withdraw Alice’s tomato soup",
      }),
    );
    expect(
      within(list).getByText(/existing public versions remain available/i),
    ).toBeVisible();
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Confirm withdrawal of Alice’s tomato soup",
      }),
    );

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/recipes/${ROOT_ID}/visibility`,
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({ "X-CSRF-Token": "csrf-value" }),
          body: JSON.stringify({ state: "author_withdrawn" }),
        }),
      ),
    );
    const completion = await screen.findByRole("status");
    expect(completion).toHaveTextContent(
      "Alice’s tomato soup moved to Withdrawn.",
    );
    expect(completion).toHaveAttribute("tabindex", "-1");
    await waitFor(() => expect(completion).toHaveFocus());
    expect(
      screen.getByRole("heading", {
        name: "You have no published recipes yet.",
      }),
    ).toBeVisible();
    expect(fetchMock).toHaveBeenLastCalledWith(
      "/api/my/recipes?view=published&page=1&page_size=12",
      expect.objectContaining({ credentials: "same-origin" }),
    );
  });

  it("moves a restored recipe out of Withdrawn and keeps the success announcement", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const withdrawnPage = {
      items: [
        {
          kind: "published",
          recipe: original(),
          visibility_state: "author_withdrawn",
        },
      ],
      page: 1,
      page_size: 12,
      total: 1,
      total_pages: 1,
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(withdrawnPage))
      .mockResolvedValueOnce(
        Response.json({
          recipe_version_id: ROOT_ID,
          state: "published",
          updated_at: "2026-08-25T13:00:00Z",
        }),
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
    authenticated(<MyRecipeLibrary pageNumber={1} view="withdrawn" />);

    const list = await screen.findByRole("list", { name: "Withdrawn recipes" });
    expect(
      within(list).queryByRole("link", { name: "Alice’s tomato soup" }),
    ).toBeNull();
    fireEvent.click(
      within(list).getByRole("button", { name: "Restore Alice’s tomato soup" }),
    );

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Alice’s tomato soup moved to Published.",
    );
    expect(
      screen.getByRole("heading", { name: "You have no withdrawn recipes." }),
    ).toBeVisible();
  });

  it("keeps visibility failures cook-facing without exposing service details", async () => {
    document.cookie = `${CSRF_COOKIE_NAME}=csrf-value; Path=/`;
    const publicPage = {
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
    };
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(publicPage))
        .mockResolvedValueOnce(
          Response.json(
            {
              error: {
                code: "visibility_service_unavailable",
                message:
                  "Canonical UUID 99999999-9999-4999-8999-999999999999 failed an operator policy check.",
              },
            },
            { status: 503 },
          ),
        ),
    );
    authenticated(<MyRecipeLibrary pageNumber={1} view="published" />);

    const list = await screen.findByRole("list", { name: "Published recipes" });
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Withdraw Alice’s tomato soup",
      }),
    );
    fireEvent.click(
      within(list).getByRole("button", {
        name: "Confirm withdrawal of Alice’s tomato soup",
      }),
    );

    expect(await within(list).findByRole("alert")).toHaveTextContent(
      "Recipe Lab could not change this recipe’s public visibility. Try again.",
    );
    expect(
      within(list).queryByText(/99999999|canonical|uuid|operator|policy/i),
    ).toBeNull();
  });

  it("keeps a moderation-hidden snapshot discoverable without author controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          items: [
            {
              kind: "published",
              recipe: original(),
              visibility_state: "moderation_hidden",
            },
          ],
          page: 1,
          page_size: 12,
          total: 1,
          total_pages: 1,
        }),
      ),
    );
    authenticated(<MyRecipeLibrary pageNumber={1} view="published" />);

    const list = await screen.findByRole("list", { name: "Published recipes" });
    expect(
      within(list).getByText("Hidden by moderation", { exact: true }),
    ).toBeVisible();
    expect(
      within(list).getByText(/visibility cannot be changed here/i),
    ).toBeVisible();
    expect(
      within(list).queryByRole("link", { name: "Alice’s tomato soup" }),
    ).toBeNull();
    expect(within(list).queryByRole("button")).toBeNull();
  });

  it("moves focus into withdrawal confirmation and returns it on cancel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
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
        }),
      ),
    );
    authenticated(<MyRecipeLibrary pageNumber={1} view="published" />);

    const list = await screen.findByRole("list", { name: "Published recipes" });
    const withdraw = within(list).getByRole("button", {
      name: "Withdraw Alice’s tomato soup",
    });
    withdraw.focus();
    fireEvent.click(withdraw);
    const confirm = within(list).getByRole("button", {
      name: "Confirm withdrawal of Alice’s tomato soup",
    });
    await waitFor(() => expect(confirm).toHaveFocus());

    const cancel = within(list).getByRole("button", {
      name: "Cancel withdrawal of Alice’s tomato soup",
    });
    fireEvent.click(cancel);
    await waitFor(() =>
      expect(
        within(list).getByRole("button", {
          name: "Withdraw Alice’s tomato soup",
        }),
      ).toHaveFocus(),
    );
  });

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

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/recipe-drafts/${DRAFT_ID}?revision=2`,
        expect.objectContaining({
          method: "DELETE",
          headers: expect.objectContaining({ "X-CSRF-Token": "csrf-value" }),
        }),
      ),
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

  it.each([
    ["drafts", "You have no private drafts yet."],
    ["published", "You have no published recipes yet."],
    ["withdrawn", "You have no withdrawn recipes."],
  ] as const)(
    "shows a useful empty state for the %s view",
    async (view, heading) => {
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

      expect(
        await screen.findByRole("heading", { name: heading }),
      ).toBeVisible();
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
      await screen.findByRole("list", { name: "Saved recipes" }),
    ).toHaveTextContent("Creamy tomato soup");
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
    expect(
      await screen.findByRole("heading", {
        name: "You have no saved recipes yet.",
      }),
    ).toBeVisible();
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
