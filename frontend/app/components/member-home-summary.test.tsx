import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MemberIngredientRequest,
  MemberIngredientRequestPage,
} from "../../lib/ingredient-catalog-api";
import {
  browseMyIngredientRequests,
  IngredientCatalogApiError,
} from "../../lib/ingredient-catalog-api";
import type { MyFollowStats } from "../../lib/member-follow-api";
import {
  fetchMyFollowStats,
  MemberFollowApiError,
} from "../../lib/member-follow-api";
import type { RecipeDraftListItem } from "../../lib/recipe-draft-api";
import type { RecipeSummary } from "../../lib/recipe-api";
import type {
  MyRecipeLibraryPage,
  SavedRecipeLibraryPage,
} from "../../lib/recipe-library-api";
import {
  fetchMyRecipeLibrary,
  fetchSavedRecipeLibrary,
  RecipeLibraryApiError,
} from "../../lib/recipe-library-api";
import { HomeLoadNotice, HomeLoadStateProvider } from "./home-load-state";
import { MemberHomeSummary } from "./member-home-summary";

const mocks = vi.hoisted(() => ({
  browseMyIngredientRequests: vi.fn(),
  fetchMyFollowStats: vi.fn(),
  fetchMyRecipeLibrary: vi.fn(),
  fetchSavedRecipeLibrary: vi.fn(),
}));

vi.mock("../../lib/member-follow-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/member-follow-api")>();
  return {
    ...actual,
    fetchMyFollowStats: mocks.fetchMyFollowStats,
  };
});

vi.mock("../../lib/ingredient-catalog-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/ingredient-catalog-api")>();
  return {
    ...actual,
    browseMyIngredientRequests: mocks.browseMyIngredientRequests,
  };
});

vi.mock("../../lib/recipe-library-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../lib/recipe-library-api")>();
  return {
    ...actual,
    fetchMyRecipeLibrary: mocks.fetchMyRecipeLibrary,
    fetchSavedRecipeLibrary: mocks.fetchSavedRecipeLibrary,
  };
});

const COOK_ID = "11111111-1111-4111-8111-111111111111";
const RECIPE_ID = "22222222-2222-4222-8222-222222222222";
const LINEAGE_ID = "33333333-3333-4333-8333-333333333333";
const DRAFT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_DRAFT_ID = "55555555-5555-4555-8555-555555555555";
const REQUEST_ID = "66666666-6666-4666-8666-666666666666";
const SOURCE_VERSION_ID = "77777777-7777-4777-8777-777777777777";

function recipe(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: RECIPE_ID,
    lineage_id: LINEAGE_ID,
    parent_version_id: null,
    version_number: 1,
    title: "Roasted tomato pasta",
    description: "A weeknight pasta.",
    servings: "4.00",
    created_at: "2026-08-25T12:00:00Z",
    published_at: "2026-08-25T13:00:00Z",
    categories: [],
    author: {
      id: COOK_ID,
      handle: "alice-cook",
      display_name: "Alice Cook",
    },
    parent: null,
    ...overrides,
  };
}

function draft(
  overrides: Partial<RecipeDraftListItem> = {},
): RecipeDraftListItem {
  return {
    id: DRAFT_ID,
    source_version_id: SOURCE_VERSION_ID,
    status: "active",
    revision: 2,
    title: "Garden stew",
    ingredient_count: 6,
    instruction_count: 4,
    created_at: "2026-08-28T09:00:00Z",
    updated_at: "2026-08-30T12:00:00Z",
    ...overrides,
  };
}

function request(
  overrides: Partial<MemberIngredientRequest> = {},
): MemberIngredientRequest {
  return {
    id: REQUEST_ID,
    proposed_name: "Mountain pepper",
    context: null,
    status: "approved",
    created_at: "2026-08-29T08:00:00Z",
    reviewed_at: "2026-08-30T14:00:00Z",
    decision_reason: null,
    resolved_ingredient_id: null,
    resolved_ingredient: null,
    ...overrides,
  };
}

function libraryPage(
  items: MyRecipeLibraryPage["items"] = [],
  total = items.length,
): MyRecipeLibraryPage {
  return {
    items,
    page: 1,
    page_size: 3,
    total,
    total_pages: total > 0 ? Math.ceil(total / 3) : 0,
  };
}

function draftPage(
  items: RecipeDraftListItem[] = [
    draft({
      id: OTHER_DRAFT_ID,
      title: "Older soup",
      updated_at: "2026-08-27T12:00:00Z",
    }),
    draft(),
  ],
  total = items.length,
): MyRecipeLibraryPage {
  return libraryPage(
    items.map((item) => ({
      kind: "draft" as const,
      draft: item,
      source_recipe_title: null,
      description: null,
    })),
    total,
  );
}

function publishedPage(
  visibilityState: "author_withdrawn" | "published" = "published",
  total = 1,
): MyRecipeLibraryPage {
  return libraryPage(
    [
      {
        kind: "published",
        recipe: recipe(),
        visibility_state: visibilityState,
      },
    ],
    total,
  );
}

function savedPage(
  total = 5,
  title = "Saved summer salad",
): SavedRecipeLibraryPage {
  return {
    items: [
      {
        recipe: recipe({ title }),
        saved_at: "2026-08-30T13:00:00Z",
      },
    ],
    page: 1,
    page_size: 3,
    total,
    total_pages: Math.ceil(total / 3),
  };
}

function requestPage(
  total = 7,
  proposedName = "Mountain pepper",
): MemberIngredientRequestPage {
  return {
    items: [request({ proposed_name: proposedName })],
    page: 1,
    page_size: 3,
    total,
    total_pages: Math.ceil(total / 3),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function metric(label: string): HTMLElement {
  const term = screen.getByText(label, { selector: "dt" });
  const container = term.closest(".member-home-summary__metric");
  if (!(container instanceof HTMLElement)) {
    throw new Error(`Could not find the ${label} metric.`);
  }
  return container;
}

function SummaryHarness({ userId }: { userId: string }) {
  return (
    <HomeLoadStateProvider>
      <HomeLoadNotice />
      <MemberHomeSummary userId={userId} />
    </HomeLoadStateProvider>
  );
}

function renderSummary(userId = "member-one") {
  return render(<SummaryHarness userId={userId} />);
}

function useSuccessfulResources() {
  mocks.fetchMyRecipeLibrary.mockImplementation(
    ({ view }: { view: "drafts" | "published" | "withdrawn" }) => {
      if (view === "drafts") return Promise.resolve(draftPage());
      if (view === "published")
        return Promise.resolve(publishedPage("published", 4));
      return Promise.resolve(publishedPage("author_withdrawn", 2));
    },
  );
  mocks.fetchSavedRecipeLibrary.mockResolvedValue(savedPage());
  mocks.fetchMyFollowStats.mockResolvedValue({
    follower_count: 9,
    following_count: 3,
  });
  mocks.browseMyIngredientRequests.mockResolvedValue(requestPage());
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-30T16:00:00Z"));
  mocks.browseMyIngredientRequests.mockReset();
  mocks.fetchMyFollowStats.mockReset();
  mocks.fetchMyRecipeLibrary.mockReset();
  mocks.fetchSavedRecipeLibrary.mockReset();
  useSuccessfulResources();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberHomeSummary", () => {
  it("starts every private summary request in parallel when mounted", async () => {
    const drafts = deferred<MyRecipeLibraryPage>();
    const published = deferred<MyRecipeLibraryPage>();
    const withdrawn = deferred<MyRecipeLibraryPage>();
    const saved = deferred<SavedRecipeLibraryPage>();
    const ingredientRequests = deferred<MemberIngredientRequestPage>();
    const followStats = deferred<MyFollowStats>();

    mocks.fetchMyRecipeLibrary.mockImplementation(
      ({ view }: { view: "drafts" | "published" | "withdrawn" }) =>
        ({ drafts, published, withdrawn })[view].promise,
    );
    mocks.fetchSavedRecipeLibrary.mockReturnValue(saved.promise);
    mocks.browseMyIngredientRequests.mockReturnValue(
      ingredientRequests.promise,
    );
    mocks.fetchMyFollowStats.mockReturnValue(followStats.promise);

    renderSummary();

    await waitFor(() => {
      expect(fetchMyRecipeLibrary).toHaveBeenCalledTimes(3);
      expect(fetchSavedRecipeLibrary).toHaveBeenCalledTimes(1);
      expect(browseMyIngredientRequests).toHaveBeenCalledTimes(1);
      expect(fetchMyFollowStats).toHaveBeenCalledTimes(1);
    });
    expect(
      mocks.fetchMyRecipeLibrary.mock.calls.map(([options]) => options.view),
    ).toEqual(["drafts", "published", "withdrawn"]);
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      drafts.resolve(draftPage());
      published.resolve(publishedPage("published", 4));
      withdrawn.resolve(publishedPage("author_withdrawn", 2));
      saved.resolve(savedPage());
      ingredientRequests.resolve(requestPage());
      followStats.resolve({ follower_count: 9, following_count: 3 });
    });
  });

  it("shows the latest draft, exact totals, and the three newest real activities", async () => {
    const { container } = renderSummary();

    const continueLink = await screen.findByRole("link", {
      name: "Open draft",
    });
    expect(
      screen.getByRole("heading", { level: 3, name: "Garden stew" }),
    ).toBeVisible();
    expect(screen.getByText("Forked recipe")).toBeVisible();
    expect(screen.getByText("6 ingredients · 4 steps")).toBeVisible();
    expect(screen.getAllByText("4 hours ago")).toHaveLength(2);
    expect(
      container.querySelector(".member-home-summary__draft-thumbnail"),
    ).toHaveAttribute("data-artwork-variant");
    expect(continueLink).toHaveAttribute(
      "href",
      `/recipes/drafts/${DRAFT_ID}`,
    );
    expect(container.textContent).not.toMatch(/\b\d+%/);

    expect(within(metric("Versions published")).getByText("4")).toBeVisible();
    expect(within(metric("Active drafts")).getByText("2")).toBeVisible();
    expect(within(metric("Saved recipes")).getByText("5")).toBeVisible();
    expect(within(metric("Followers")).getByText("9")).toBeVisible();
    expect(
      within(metric("Versions published")).getByRole("link", {
        name: "View published versions",
      }),
    ).toHaveAttribute("href", "/account/recipes?view=published");
    expect(
      within(metric("Active drafts")).getByRole("link", {
        name: "View active drafts",
      }),
    ).toHaveAttribute("href", "/account/recipes?view=drafts");
    expect(
      within(metric("Saved recipes")).getByRole("link", {
        name: "View saved recipes",
      }),
    ).toHaveAttribute("href", "/account/recipes?view=saved");
    expect(
      within(metric("Followers")).getByRole("link", {
        name: "View followers",
      }),
    ).toHaveAttribute("href", "/account/followers");
    expect(
      screen.getByRole("heading", { level: 2, name: "Your stats" }),
    ).toBeVisible();
    expect(
      screen.getByRole("heading", { level: 2, name: "Your activity" }),
    ).toBeVisible();

    const activity = screen.getByRole("list", {
      name: "Recent account activity",
    });
    const items = within(activity).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Ingredient request approved");
    expect(items[0]).toHaveTextContent("Mountain pepper");
    expect(items[0]).toHaveTextContent("2 hours ago");
    expect(items[0].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-30T14:00:00Z",
    );
    expect(items[1]).toHaveTextContent("Saved recipe");
    expect(items[1]).toHaveTextContent("Saved summer salad");
    expect(items[1]).toHaveTextContent("3 hours ago");
    expect(items[1].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-30T13:00:00Z",
    );
    expect(items[2]).toHaveTextContent("Updated draft");
    expect(items[2]).toHaveTextContent("Garden stew");
    expect(items[2]).toHaveTextContent("4 hours ago");
    expect(items[2].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-30T12:00:00Z",
    );
    expect(
      activity.querySelectorAll(".member-home-summary__activity-icon svg"),
    ).toHaveLength(3);
    expect(
      screen.getByRole("link", { name: "View all activity" }),
    ).toHaveAttribute("href", "/account/activity");
  });

  it("hides the continue panel when there are no active drafts", async () => {
    mocks.fetchMyRecipeLibrary.mockImplementation(
      ({ view }: { view: "drafts" | "published" | "withdrawn" }) => {
        if (view === "drafts") return Promise.resolve(draftPage([], 0));
        if (view === "published") {
          return Promise.resolve(publishedPage("published", 4));
        }
        return Promise.resolve(publishedPage("author_withdrawn", 2));
      },
    );

    renderSummary();

    expect(
      await within(metric("Active drafts")).findByRole("link", {
        name: "View active drafts",
      }),
    ).toHaveTextContent("0");
    expect(
      screen.queryByRole("heading", { name: "Continue where you left off" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("You have no active drafts right now."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Start a recipe" })).not.toBeInTheDocument();
  });

  it("loads only reviewed ingredient requests for activity", async () => {
    mocks.browseMyIngredientRequests.mockResolvedValue({
      items: [
        request({
          created_at: "2026-08-01T08:00:00Z",
          proposed_name: "Recently reviewed herb",
          reviewed_at: "2026-08-30T15:00:00Z",
        }),
      ],
      page: 1,
      page_size: 3,
      total: 1,
      total_pages: 1,
    });

    renderSummary();

    const activity = await screen.findByRole("list", {
      name: "Recent account activity",
    });
    expect(activity).toHaveTextContent("Recently reviewed herb");
    expect(within(metric("Followers")).getByText("9")).toBeVisible();
    expect(
      screen.queryByText("Ingredient requests", { selector: "dt" }),
    ).not.toBeInTheDocument();
    expect(browseMyIngredientRequests).toHaveBeenCalledTimes(1);
    expect(browseMyIngredientRequests).toHaveBeenCalledWith(
      expect.objectContaining({
        page: 1,
        pageSize: 3,
        reviewedOnly: true,
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("keeps successful panels visible and retries only the failed resource", async () => {
    const failure = new RecipeLibraryApiError(
      "Saved recipes are temporarily unavailable.",
      503,
    );
    mocks.fetchSavedRecipeLibrary
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(savedPage(8, "Recovered favorite"));

    renderSummary();

    expect(
      await screen.findByRole("heading", { level: 3, name: "Garden stew" }),
    ).toBeVisible();
    expect(within(metric("Active drafts")).getByText("2")).toBeVisible();
    expect(within(metric("Followers")).getByText("9")).toBeVisible();
    expect(
      await within(metric("Saved recipes")).findByLabelText(
        "Saved recipes unavailable",
      ),
    ).toHaveTextContent("—");
    const activityPanel = screen.getByRole("region", { name: "Your activity" });
    expect(
      within(activityPanel).getByRole("list", { name: "Recent account activity" }),
    ).toBeVisible();
    expect(within(activityPanel).queryByRole("alert")).toBeNull();
    const notice = await screen.findByRole("status", {
      name: "Some homepage information couldn’t be updated.",
    });
    expect(notice).toBeVisible();

    fireEvent.click(within(notice).getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(within(metric("Saved recipes")).getByText("8")).toBeVisible();
    });
    expect(fetchSavedRecipeLibrary).toHaveBeenCalledTimes(2);
    expect(fetchMyRecipeLibrary).toHaveBeenCalledTimes(3);
    expect(browseMyIngredientRequests).toHaveBeenCalledTimes(1);
    expect(fetchMyFollowStats).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("list", {
        name: "Recent account activity",
      }),
    ).toHaveTextContent("Recovered favorite");
  });

  it("leaves session recovery separate from the homepage outage notice", async () => {
    mocks.fetchMyFollowStats.mockRejectedValueOnce(
      new MemberFollowApiError("Your session expired.", 401),
    );

    renderSummary();

    expect(
      await within(metric("Followers")).findByLabelText(
        "Followers unavailable",
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("list", { name: "Recent account activity" }),
    ).toBeVisible();
    expect(
      within(screen.getByRole("region", { name: "Your activity" })).queryByText(
        /followers/i,
      ),
    ).not.toBeInTheDocument();

    expect(
      screen.queryByRole("status", {
        name: "Some homepage information couldn’t be updated.",
      }),
    ).toBeNull();
    expect(fetchMyFollowStats).toHaveBeenCalledTimes(1);
    expect(browseMyIngredientRequests).toHaveBeenCalledTimes(1);
    expect(fetchSavedRecipeLibrary).toHaveBeenCalledTimes(1);
    expect(fetchMyRecipeLibrary).toHaveBeenCalledTimes(3);
  });

  it("keeps the published total independent from withdrawn activity loading", async () => {
    const withdrawn = deferred<MyRecipeLibraryPage>();
    mocks.fetchMyRecipeLibrary.mockImplementation(
      ({ view }: { view: "drafts" | "published" | "withdrawn" }) => {
        if (view === "drafts") return Promise.resolve(draftPage());
        if (view === "withdrawn") return withdrawn.promise;
        return Promise.reject(
          new RecipeLibraryApiError(
            "Published recipes are temporarily unavailable.",
            503,
          ),
        );
      },
    );

    renderSummary();

    const versionMetric = metric("Versions published");
    expect(
      await within(versionMetric).findByLabelText(
        "Versions published unavailable",
      ),
    ).toBeVisible();
    const notice = await screen.findByRole("status", {
      name: "Some homepage information couldn’t be updated.",
    });
    expect(within(notice).getAllByRole("button", { name: "Try again" })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Retry published/i })).toBeNull();
    expect(within(metric("Saved recipes")).getByText("5")).toBeVisible();

    await act(async () => {
      withdrawn.resolve(publishedPage("author_withdrawn", 2));
    });
  });

  it("aborts the old account requests and never renders their late results", async () => {
    const accountA = {
      drafts: deferred<MyRecipeLibraryPage>(),
      published: deferred<MyRecipeLibraryPage>(),
      withdrawn: deferred<MyRecipeLibraryPage>(),
      saved: deferred<SavedRecipeLibraryPage>(),
      ingredientRequests: deferred<MemberIngredientRequestPage>(),
      followStats: deferred<MyFollowStats>(),
    };
    const accountB = {
      drafts: deferred<MyRecipeLibraryPage>(),
      published: deferred<MyRecipeLibraryPage>(),
      withdrawn: deferred<MyRecipeLibraryPage>(),
      saved: deferred<SavedRecipeLibraryPage>(),
      ingredientRequests: deferred<MemberIngredientRequestPage>(),
      followStats: deferred<MyFollowStats>(),
    };
    const libraryQueues = {
      drafts: [accountA.drafts, accountB.drafts],
      published: [accountA.published, accountB.published],
      withdrawn: [accountA.withdrawn, accountB.withdrawn],
    };
    const savedQueue = [accountA.saved, accountB.saved];
    const requestQueue = [
      accountA.ingredientRequests,
      accountB.ingredientRequests,
    ];
    const followStatsQueue = [accountA.followStats, accountB.followStats];

    mocks.fetchMyRecipeLibrary.mockImplementation(
      ({ view }: { view: "drafts" | "published" | "withdrawn" }) => {
        const next = libraryQueues[view].shift();
        if (!next) throw new Error(`Missing ${view} response.`);
        return next.promise;
      },
    );
    mocks.fetchSavedRecipeLibrary.mockImplementation(() => {
      const next = savedQueue.shift();
      if (!next) throw new Error("Missing saved response.");
      return next.promise;
    });
    mocks.browseMyIngredientRequests.mockImplementation(() => {
      const next = requestQueue.shift();
      if (!next) throw new Error("Missing ingredient-request response.");
      return next.promise;
    });
    mocks.fetchMyFollowStats.mockImplementation(() => {
      const next = followStatsQueue.shift();
      if (!next) throw new Error("Missing follow-stats response.");
      return next.promise;
    });

    const { rerender } = renderSummary("member-a");
    await waitFor(() => {
      expect(fetchMyRecipeLibrary).toHaveBeenCalledTimes(3);
      expect(fetchSavedRecipeLibrary).toHaveBeenCalledTimes(1);
      expect(browseMyIngredientRequests).toHaveBeenCalledTimes(1);
      expect(fetchMyFollowStats).toHaveBeenCalledTimes(1);
    });
    const accountALibrarySignals = mocks.fetchMyRecipeLibrary.mock.calls.map(
      ([options]) => options.signal as AbortSignal,
    );
    const accountASavedSignal = mocks.fetchSavedRecipeLibrary.mock.calls[0][0]
      .signal as AbortSignal;
    const accountARequestSignal = mocks.browseMyIngredientRequests.mock
      .calls[0][0].signal as AbortSignal;
    const accountAFollowStatsSignal = mocks.fetchMyFollowStats.mock
      .calls[0][0] as AbortSignal | undefined;

    rerender(<SummaryHarness userId="member-b" />);

    await waitFor(() => {
      expect(fetchMyRecipeLibrary).toHaveBeenCalledTimes(6);
      expect(fetchSavedRecipeLibrary).toHaveBeenCalledTimes(2);
      expect(browseMyIngredientRequests).toHaveBeenCalledTimes(2);
      expect(fetchMyFollowStats).toHaveBeenCalledTimes(2);
    });
    expect(accountALibrarySignals.every((signal) => signal.aborted)).toBe(true);
    expect(accountASavedSignal.aborted).toBe(true);
    expect(accountARequestSignal.aborted).toBe(true);
    expect(accountAFollowStatsSignal?.aborted).toBe(true);

    await act(async () => {
      accountA.drafts.resolve(
        draftPage([draft({ title: "Alice private draft" })], 1),
      );
      accountA.published.resolve(publishedPage("published", 10));
      accountA.withdrawn.resolve(publishedPage("author_withdrawn", 11));
      accountA.saved.resolve(savedPage(12, "Alice private favorite"));
      accountA.ingredientRequests.resolve(
        requestPage(13, "Alice private request"),
      );
      accountA.followStats.resolve({ follower_count: 13, following_count: 6 });

      accountB.drafts.resolve(
        draftPage(
          [draft({ source_version_id: null, title: "Bob current draft" })],
          1,
        ),
      );
      accountB.published.resolve(publishedPage("published", 2));
      accountB.withdrawn.resolve(publishedPage("author_withdrawn", 3));
      accountB.saved.resolve(savedPage(4, "Bob current favorite"));
      accountB.ingredientRequests.resolve(
        requestPage(5, "Bob current request"),
      );
      accountB.followStats.resolve({ follower_count: 5, following_count: 2 });
    });

    expect(
      await screen.findByRole("heading", {
        level: 3,
        name: "Bob current draft",
      }),
    ).toBeVisible();
    expect(screen.getByText("Original recipe")).toBeVisible();
    expect(screen.queryByText(/Alice private/)).not.toBeInTheDocument();
    expect(within(metric("Versions published")).getByText("2")).toBeVisible();
    expect(within(metric("Saved recipes")).getByText("4")).toBeVisible();
    expect(within(metric("Followers")).getByText("5")).toBeVisible();
  });

  it("reports and retries an ingredient-activity failure without restoring the old stat", async () => {
    const failure = new IngredientCatalogApiError(
      "Your ingredient requests are resting. Please retry.",
      503,
    );
    mocks.browseMyIngredientRequests
      .mockRejectedValueOnce(failure)
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(requestPage(1, "Recovered request"));

    renderSummary();

    const activity = screen.getByRole("region", { name: "Your activity" });
    const notice = await screen.findByRole("status", {
      name: "Some homepage information couldn’t be updated.",
    });
    expect(within(activity).queryByRole("alert")).toBeNull();
    expect(
      screen.queryByText("Ingredient requests", { selector: "dt" }),
    ).not.toBeInTheDocument();
    expect(within(metric("Followers")).getByText("9")).toBeVisible();

    fireEvent.click(within(notice).getByRole("button", { name: "Try again" }));

    await waitFor(() => {
      expect(
        within(activity).getByRole("list", { name: "Recent account activity" }),
      ).toHaveTextContent("Recovered request");
    });
    expect(browseMyIngredientRequests).toHaveBeenCalledTimes(3);
    expect(fetchMyFollowStats).toHaveBeenCalledTimes(1);
  });
});
