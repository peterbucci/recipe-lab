import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicCookProfilePage } from "../../lib/recipe-library-api";
import type { RecipeCardSummary } from "../../lib/recipe-api";
import { CSRF_COOKIE_NAME } from "../../lib/auth-api";
import { buildRecipeCardSummary } from "../../test/builders/recipe";
import { deferred } from "../../test/deferred";
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
const ORIGINAL_DRAFT_ID = "77777777-7777-4777-8777-777777777777";

const alice = { id: ALICE_ID, handle: "alice", display_name: "Alice Cook" };
const catalog = {
  id: CATALOG_ID,
  handle: "recipe-lab",
  display_name: "Recipe Lab catalog",
};

function original(
  overrides: Partial<RecipeCardSummary> = {},
): RecipeCardSummary {
  return buildRecipeCardSummary({
    id: ROOT_ID,
    lineage_id: LINEAGE_ID,
    title: "Alice’s tomato soup",
    description: "A bright soup.",
    servings: "4.00",
    created_at: "2026-08-25T10:00:00Z",
    published_at: "2026-08-25T11:00:00Z",
    author: alice,
    average_rating: 4.5,
    rating_count: 2,
    save_count: 7,
    ...overrides,
  });
}

function fork(): RecipeCardSummary {
  return original({
    id: FORK_ID,
    parent_version_id: ROOT_ID,
    version_number: 2,
    title: "Creamy tomato soup",
    average_rating: null,
    rating_count: 0,
    save_count: 3,
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
    follower_count: 4,
    description: "A home cook sharing practical weeknight recipes.",
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

function anonymous(children: React.ReactNode) {
  return render(
    <AuthSessionProvider initialSession={{ status: "anonymous" }}>
      {children}
    </AuthSessionProvider>,
  );
}

afterEach(() => {
  document.cookie = `${CSRF_COOKIE_NAME}=; Max-Age=0; Path=/`;
  routerMocks.replace.mockReset();
  vi.unstubAllGlobals();
});

describe("cook profile and private recipe libraries", () => {
  it("renders public profile recipes with the shared engagement-card layout", () => {
    anonymous(<CookProfileView data={profile()} />);

    expect(
      screen.getByRole("heading", { name: "Alice Cook", level: 1 }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "Recipes", level: 2 }),
    ).toBeVisible();
    expect(
      screen.queryByText("Only publicly readable versions appear here."),
    ).toBeNull();
    expect(
      screen.queryByRole("link", { name: "← All recipes" }),
    ).toBeNull();
    expect(screen.getByText("@alice", { exact: true })).toBeVisible();
    expect(screen.getByText("4 followers", { exact: true })).toBeVisible();
    expect(screen.getByText("13 recipes", { exact: true })).toBeVisible();
    expect(screen.getByText(/home cook sharing practical weeknight recipes/i)).toBeVisible();
    expect(screen.queryByText("Cook profile", { exact: true })).toBeNull();
    expect(document.querySelector(".cook-profile__meta")).toHaveTextContent(
      "@alice•4 followers•13 recipes",
    );
    expect(document.querySelector(".cook-profile__avatar")).toHaveTextContent("A");
    const description = document.querySelector(".cook-profile__description");
    const follow = screen.getByRole("link", { name: "Follow" });
    expect(description?.compareDocumentPosition(follow)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(follow).toHaveAttribute(
      "href",
      "/sign-in?return_to=%2Fcooks%2Falice",
    );
    const list = screen.getByRole("list", {
      name: "Public recipes by Alice Cook",
    });
    expect(within(list).getAllByRole("article")).toHaveLength(2);
    expect(
      within(list).getAllByRole("link", { name: "Alice Cook" })[0],
    ).toHaveAttribute("href", "/cooks/alice");
    expect(within(list).queryByText(/^version \d+$/i)).not.toBeInTheDocument();
    expect(within(list).getByText("Original", { exact: true })).toBeVisible();
    expect(within(list).getByText(/based on/i)).toHaveTextContent(
      "Based on Catalog tomato soup",
    );
    expect(within(list).queryByText(/by Recipe Lab catalog/i)).toBeNull();
    expect(within(list).queryByText("A bright soup.")).toBeNull();
    expect(
      within(list).getByRole("img", {
        name: "4.5 out of 5 from 2 ratings",
      }),
    ).toBeVisible();
    expect(
      within(list).getByRole("img", { name: "No ratings yet" }),
    ).toBeVisible();
    expect(within(list).getByText("7 saves")).toBeVisible();
    expect(within(list).getByText("3 saves")).toBeVisible();
    expect(within(list).getAllByText("4 servings")).toHaveLength(2);
    expect(within(list).getByText(/based on/i)).toHaveTextContent(
      "Based on Catalog tomato soup",
    );
    expect(
      within(list).getByRole("link", {
        name: "Sign in to save Alice’s tomato soup",
      }),
    ).toBeVisible();
    expect(
      within(list).getByRole("link", {
        name: "Sign in to save Creamy tomato soup",
      }),
    ).toBeVisible();
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

  it("pluralizes profile counts and omits an empty description without a placeholder", () => {
    authenticated(
      <CookProfileView
        data={profile({
          description: null,
          follower_count: 1,
          items: [original()],
          total: 1,
          total_pages: 1,
        })}
      />,
    );

    expect(document.querySelector(".cook-profile__meta")).toHaveTextContent(
      "@alice•1 follower•1 recipe",
    );
    expect(document.querySelector(".cook-profile__description")).toBeNull();
    const header = document.querySelector<HTMLElement>(
      ".cook-profile__header",
    );
    expect(
      within(header!).queryByRole("button", { name: /follow/i }),
    ).toBeNull();
    expect(
      within(header!).queryByRole("link", { name: "Follow" }),
    ).toBeNull();
  });

  it("treats a cook with no public recipes as a valid empty profile", () => {
    anonymous(
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
    const retry = vi.fn();
    const { rerender } = render(<CookProfileLoading />);
    expect(screen.getByRole("main")).toHaveClass(
      "page-loading--cook",
      "public-cook-page",
    );
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("Loading cook profile…");

    rerender(<CookProfileError retry={retry} />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "We couldn’t load this cook’s profile.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();

    rerender(<CookProfileNotFound />);
    expect(
      screen.getByRole("heading", { name: "We couldn’t find that cook." }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Browse recipes" }),
    ).toHaveAttribute("href", "/recipes");
  });

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

  it("renders Deleted cook and an unavailable source without profile or source links", () => {
    anonymous(
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
      within(list).getByText("Based on unavailable source", { exact: true }),
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

    const visibilityPath = `/api/recipes/${ROOT_ID}/visibility`;
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([target]) => target === visibilityPath),
      ).toBe(true),
    );
    const visibilityCall = fetchMock.mock.calls.find(
      ([target]) => target === visibilityPath,
    );
    expect(visibilityCall?.[1]).toMatchObject({
      method: "PUT",
      body: JSON.stringify({ state: "author_withdrawn" }),
    });
    expect(new Headers(visibilityCall?.[1]?.headers).get("X-CSRF-Token")).toBe(
      "csrf-value",
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
    const withdrawnHeader = screen
      .getByRole("heading", { level: 2, name: "Withdrawn recipes" })
      .closest("header");
    expect(withdrawnHeader).toHaveClass("workspace-panel-header");
    expect(withdrawnHeader).toHaveTextContent(
      "Withdrawn recipes are no longer public, but you can review or restore them here.",
    );
    expect(withdrawnHeader).toHaveTextContent("1 withdrawn recipe");
    const withdrawnCard = within(list).getByRole("article", {
      name: "Alice’s tomato soup",
    });
    expect(withdrawnCard).toHaveClass(
      "member-recipe-card",
      "member-recipe-card--withdrawn",
    );
    expect(
      within(withdrawnCard).getByText("Original", { exact: true }),
    ).toBeVisible();
    expect(within(withdrawnCard).queryByText("4 servings")).toBeNull();
    expect(
      within(withdrawnCard).getByText(/recipe-family history is preserved/i),
    ).toBeVisible();
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
    expect(within(list).getByText("Original", { exact: true })).toBeVisible();
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
      expect(emptyState).toHaveClass("empty-state", "workspace-empty-state");
      expect(within(emptyState!).getByText("Nothing here yet")).toHaveClass(
        "eyebrow",
        "workspace-empty-state__eyebrow",
      );
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
    expect(emptyState).toHaveClass("empty-state", "workspace-empty-state");
    expect(within(emptyState!).getByText("Nothing here yet")).toHaveClass(
      "eyebrow",
      "workspace-empty-state__eyebrow",
    );
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
