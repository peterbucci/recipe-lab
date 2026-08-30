import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MemberIngredientRequest,
  MemberIngredientRequestPage,
} from "../../lib/ingredient-catalog-api";
import {
  browseMyIngredientRequests,
  IngredientCatalogApiError,
} from "../../lib/ingredient-catalog-api";
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
import { MemberHomeSummary } from "./member-home-summary";

const mocks = vi.hoisted(() => ({
  browseMyIngredientRequests: vi.fn(),
  fetchMyRecipeLibrary: vi.fn(),
  fetchSavedRecipeLibrary: vi.fn(),
}));

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
    items.map((item) => ({ kind: "draft" as const, draft: item })),
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

function useSuccessfulResources() {
  mocks.fetchMyRecipeLibrary.mockImplementation(
    ({ view }: { view: "drafts" | "published" | "withdrawn" }) => {
      if (view === "drafts") return Promise.resolve(draftPage());
      if (view === "published") return Promise.resolve(publishedPage("published", 4));
      return Promise.resolve(publishedPage("author_withdrawn", 2));
    },
  );
  mocks.fetchSavedRecipeLibrary.mockResolvedValue(savedPage());
  mocks.browseMyIngredientRequests.mockResolvedValue(requestPage());
}

beforeEach(() => {
  mocks.browseMyIngredientRequests.mockReset();
  mocks.fetchMyRecipeLibrary.mockReset();
  mocks.fetchSavedRecipeLibrary.mockReset();
  useSuccessfulResources();
});

describe("MemberHomeSummary", () => {
  it("starts every private summary request in parallel when mounted", async () => {
    const drafts = deferred<MyRecipeLibraryPage>();
    const published = deferred<MyRecipeLibraryPage>();
    const withdrawn = deferred<MyRecipeLibraryPage>();
    const saved = deferred<SavedRecipeLibraryPage>();
    const ingredientRequests = deferred<MemberIngredientRequestPage>();

    mocks.fetchMyRecipeLibrary.mockImplementation(
      ({ view }: { view: "drafts" | "published" | "withdrawn" }) =>
        ({ drafts, published, withdrawn })[view].promise,
    );
    mocks.fetchSavedRecipeLibrary.mockReturnValue(saved.promise);
    mocks.browseMyIngredientRequests.mockReturnValue(ingredientRequests.promise);

    render(<MemberHomeSummary userId="member-one" />);

    await waitFor(() => {
      expect(fetchMyRecipeLibrary).toHaveBeenCalledTimes(3);
      expect(fetchSavedRecipeLibrary).toHaveBeenCalledTimes(1);
      expect(browseMyIngredientRequests).toHaveBeenCalledTimes(1);
    });
    expect(
      mocks.fetchMyRecipeLibrary.mock.calls.map(([options]) => options.view),
    ).toEqual(["drafts", "published", "withdrawn"]);
    expect(screen.getAllByRole("status").length).toBeGreaterThanOrEqual(5);

    await act(async () => {
      drafts.resolve(draftPage());
      published.resolve(publishedPage("published", 4));
      withdrawn.resolve(publishedPage("author_withdrawn", 2));
      saved.resolve(savedPage());
      ingredientRequests.resolve(requestPage());
    });
  });

  it("shows the latest draft, exact totals, and the three newest real activities", async () => {
    const { container } = render(<MemberHomeSummary userId="member-one" />);

    const continueLink = await screen.findByRole("link", {
      name: "Continue draft",
    });
    expect(screen.getByRole("heading", { level: 3, name: "Garden stew" })).toBeVisible();
    expect(screen.getByText("Version draft")).toBeVisible();
    expect(continueLink).toHaveAttribute(
      "href",
      `/account/recipe-drafts/${DRAFT_ID}`,
    );
    expect(container.textContent).not.toMatch(/\b\d+%/);

    expect(within(metric("Versions published")).getByText("6")).toBeVisible();
    expect(within(metric("Active drafts")).getByText("2")).toBeVisible();
    expect(within(metric("Saved recipes")).getByText("5")).toBeVisible();
    expect(within(metric("Ingredient requests")).getByText("7")).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Your stats" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Your activity" })).toBeVisible();

    const activity = screen.getByRole("list", {
      name: "Recent account activity",
    });
    const items = within(activity).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent("Ingredient request approved");
    expect(items[0]).toHaveTextContent("Mountain pepper");
    expect(items[0].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-30T14:00:00Z",
    );
    expect(items[1]).toHaveTextContent("Saved recipe");
    expect(items[1]).toHaveTextContent("Saved summer salad");
    expect(items[1].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-30T13:00:00Z",
    );
    expect(items[2]).toHaveTextContent("Updated draft");
    expect(items[2]).toHaveTextContent("Garden stew");
    expect(items[2].querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-08-30T12:00:00Z",
    );
  });

  it("keeps successful panels visible and retries only the failed resource", async () => {
    mocks.fetchSavedRecipeLibrary
      .mockRejectedValueOnce(
        new RecipeLibraryApiError(
          "Saved recipes are temporarily unavailable.",
          503,
        ),
      )
      .mockResolvedValueOnce(savedPage(8, "Recovered favorite"));

    render(<MemberHomeSummary userId="member-one" />);

    expect(
      await screen.findByRole("heading", { level: 3, name: "Garden stew" }),
    ).toBeVisible();
    expect(within(metric("Active drafts")).getByText("2")).toBeVisible();
    expect(within(metric("Ingredient requests")).getByText("7")).toBeVisible();
    expect(within(metric("Saved recipes")).getByRole("alert")).toHaveTextContent(
      "Unavailable",
    );
    const activityPanel = screen.getByRole("region", { name: "Your activity" });
    expect(within(activityPanel).getByText(/saved recipes/i, { selector: "p" })).toHaveTextContent(
      /some recent activity is unavailable/i,
    );

    fireEvent.click(
      within(activityPanel).getByRole("button", {
        name: "Retry saved recipes for activity",
      }),
    );

    await waitFor(() => {
      expect(within(metric("Saved recipes")).getByText("8")).toBeVisible();
    });
    expect(fetchSavedRecipeLibrary).toHaveBeenCalledTimes(2);
    expect(fetchMyRecipeLibrary).toHaveBeenCalledTimes(3);
    expect(browseMyIngredientRequests).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("list", {
        name: "Recent account activity",
      }),
    ).toHaveTextContent("Recovered favorite");
  });

  it("surfaces one failed version total while its companion is still loading", async () => {
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

    render(<MemberHomeSummary userId="member-one" />);

    const versionMetric = metric("Versions published");
    expect(
      await within(versionMetric).findByRole("button", {
        name: "Retry published recipes",
      }),
    ).toBeVisible();
    expect(within(versionMetric).getByRole("alert")).toHaveTextContent(
      "Other version totals are still loading.",
    );
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
    };
    const accountB = {
      drafts: deferred<MyRecipeLibraryPage>(),
      published: deferred<MyRecipeLibraryPage>(),
      withdrawn: deferred<MyRecipeLibraryPage>(),
      saved: deferred<SavedRecipeLibraryPage>(),
      ingredientRequests: deferred<MemberIngredientRequestPage>(),
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

    const { rerender } = render(<MemberHomeSummary userId="member-a" />);
    await waitFor(() => expect(fetchMyRecipeLibrary).toHaveBeenCalledTimes(3));
    const accountALibrarySignals = mocks.fetchMyRecipeLibrary.mock.calls.map(
      ([options]) => options.signal as AbortSignal,
    );
    const accountASavedSignal = mocks.fetchSavedRecipeLibrary.mock.calls[0][0]
      .signal as AbortSignal;
    const accountARequestSignal = mocks.browseMyIngredientRequests.mock.calls[0][0]
      .signal as AbortSignal;

    rerender(<MemberHomeSummary userId="member-b" />);

    await waitFor(() => {
      expect(fetchMyRecipeLibrary).toHaveBeenCalledTimes(6);
      expect(fetchSavedRecipeLibrary).toHaveBeenCalledTimes(2);
      expect(browseMyIngredientRequests).toHaveBeenCalledTimes(2);
    });
    expect(accountALibrarySignals.every((signal) => signal.aborted)).toBe(true);
    expect(accountASavedSignal.aborted).toBe(true);
    expect(accountARequestSignal.aborted).toBe(true);

    await act(async () => {
      accountA.drafts.resolve(
        draftPage([draft({ title: "Alice private draft" })], 1),
      );
      accountA.published.resolve(publishedPage("published", 10));
      accountA.withdrawn.resolve(publishedPage("author_withdrawn", 11));
      accountA.saved.resolve(savedPage(12, "Alice private favorite"));
      accountA.ingredientRequests.resolve(requestPage(13, "Alice private request"));

      accountB.drafts.resolve(
        draftPage(
          [draft({ source_version_id: null, title: "Bob current draft" })],
          1,
        ),
      );
      accountB.published.resolve(publishedPage("published", 2));
      accountB.withdrawn.resolve(publishedPage("author_withdrawn", 3));
      accountB.saved.resolve(savedPage(4, "Bob current favorite"));
      accountB.ingredientRequests.resolve(requestPage(5, "Bob current request"));
    });

    expect(
      await screen.findByRole("heading", { level: 3, name: "Bob current draft" }),
    ).toBeVisible();
    expect(screen.getByText("Original draft")).toBeVisible();
    expect(screen.queryByText(/Alice private/)).not.toBeInTheDocument();
    expect(within(metric("Versions published")).getByText("5")).toBeVisible();
    expect(within(metric("Saved recipes")).getByText("4")).toBeVisible();
    expect(within(metric("Ingredient requests")).getByText("5")).toBeVisible();
  });

  it("uses ordinary public errors but preserves safe API messages", async () => {
    mocks.browseMyIngredientRequests.mockRejectedValueOnce(
      new IngredientCatalogApiError(
        "Your ingredient requests are resting. Please retry.",
        503,
      ),
    );

    render(<MemberHomeSummary userId="member-one" />);

    expect(
      await screen.findByText(
        /Your ingredient requests are resting\. Please retry\./,
      ),
    ).toBeVisible();
  });
});
