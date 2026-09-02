import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  MemberIngredientRequest,
  MemberIngredientRequestPage,
} from "../../lib/ingredient-catalog-api";
import type { RecipeDraftListItem } from "../../lib/recipe-draft-api";
import type { RecipeSummary } from "../../lib/recipe-api";
import type {
  MyRecipeLibraryPage,
  SavedRecipeLibraryPage,
} from "../../lib/recipe-library-api";
import { AuthSessionProvider } from "./auth-session-provider";
import { MemberActivityTimeline } from "./member-activity-timeline";

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

const MEMBER = {
  display_name: "Peter",
  handle: "peter",
  id: "11111111-1111-4111-8111-111111111111",
};

const DRAFT: RecipeDraftListItem = {
  created_at: "2026-08-30T10:00:00Z",
  id: "22222222-2222-4222-8222-222222222222",
  ingredient_count: 7,
  instruction_count: 3,
  revision: 2,
  source_version_id: null,
  status: "active",
  title: "Banana oat pancakes",
  updated_at: "2026-08-30T15:00:00Z",
};

const RECIPE: RecipeSummary = {
  author: {
    display_name: "Peter",
    handle: "peter",
    id: MEMBER.id,
  },
  categories: [],
  created_at: "2026-08-28T10:00:00Z",
  description: "A bright weeknight dinner.",
  id: "33333333-3333-4333-8333-333333333333",
  lineage_id: "44444444-4444-4444-8444-444444444444",
  parent: null,
  parent_version_id: null,
  published_at: "2026-08-28T11:00:00Z",
  servings: "4.00",
  title: "Citrus lentil stew",
  version_number: 1,
};

const SAVED_RECIPE: RecipeSummary = {
  ...RECIPE,
  id: "55555555-5555-4555-8555-555555555555",
  lineage_id: "66666666-6666-4666-8666-666666666666",
  published_at: "2026-08-27T11:00:00Z",
  title: "Garlic butter noodles",
};

const REVIEWED_REQUEST: MemberIngredientRequest = {
  context: "A tart herb for soups.",
  created_at: "2026-08-28T08:00:00Z",
  decision_reason: "Added to the catalog.",
  id: "77777777-7777-4777-8777-777777777777",
  proposed_name: "Mountain sorrel",
  resolved_ingredient: null,
  resolved_ingredient_id: null,
  reviewed_at: "2026-08-29T14:00:00Z",
  status: "rejected",
};

function libraryPage(
  items: MyRecipeLibraryPage["items"] = [],
): MyRecipeLibraryPage {
  return {
    items,
    page: 1,
    page_size: 100,
    total: items.length,
    total_pages: items.length === 0 ? 0 : 1,
  };
}

const savedPage: SavedRecipeLibraryPage = {
  items: [],
  page: 1,
  page_size: 100,
  total: 0,
  total_pages: 0,
};

const ingredientRequestPage: MemberIngredientRequestPage = {
  items: [],
  page: 1,
  page_size: 100,
  total: 0,
  total_pages: 0,
};

function savedLibraryPage(
  items: SavedRecipeLibraryPage["items"] = [],
): SavedRecipeLibraryPage {
  return {
    items,
    page: 1,
    page_size: 100,
    total: items.length,
    total_pages: items.length === 0 ? 0 : 1,
  };
}

function ingredientRequestsPage(
  items: MemberIngredientRequestPage["items"] = [],
): MemberIngredientRequestPage {
  return {
    items,
    page: 1,
    page_size: 100,
    total: items.length,
    total_pages: items.length === 0 ? 0 : 1,
  };
}

function draftLibraryItem(draft: RecipeDraftListItem) {
  return {
    description: null,
    draft,
    kind: "draft" as const,
    source_recipe_title: null,
  };
}

function renderTimeline() {
  return render(
    <AuthSessionProvider
      initialSession={{ status: "authenticated", user: MEMBER }}
    >
      <MemberActivityTimeline />
    </AuthSessionProvider>,
  );
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-08-30T16:00:00Z"));
  mocks.browseMyIngredientRequests.mockReset();
  mocks.fetchMyRecipeLibrary.mockReset();
  mocks.fetchSavedRecipeLibrary.mockReset();
  mocks.fetchMyRecipeLibrary.mockImplementation(
    ({ view }: { view: "drafts" | "published" | "withdrawn" }) =>
      Promise.resolve(
        view === "drafts"
          ? libraryPage([
              {
                draft: DRAFT,
                kind: "draft",
                source_recipe_title: null,
                description: null,
              },
            ])
          : libraryPage(),
      ),
  );
  mocks.fetchSavedRecipeLibrary.mockResolvedValue(savedPage);
  mocks.browseMyIngredientRequests.mockResolvedValue(ingredientRequestPage);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("MemberActivityTimeline", () => {
  it("uses the shared row loader while activity sources resolve", () => {
    const pending = new Promise<never>(() => undefined);
    mocks.fetchMyRecipeLibrary.mockReturnValue(pending);
    mocks.fetchSavedRecipeLibrary.mockReturnValue(pending);
    mocks.browseMyIngredientRequests.mockReturnValue(pending);

    render(
      <AuthSessionProvider
        initialSession={{ status: "authenticated", user: MEMBER }}
      >
        <MemberActivityTimeline />
      </AuthSessionProvider>,
    );

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Loading your activity…");
    expect(status.closest(".section-loading--rows")).not.toBeNull();
  });

  it("uses the shared empty state when the member has no activity", async () => {
    mocks.fetchMyRecipeLibrary.mockResolvedValue(libraryPage());
    mocks.fetchSavedRecipeLibrary.mockResolvedValue(savedLibraryPage());
    mocks.browseMyIngredientRequests.mockResolvedValue(ingredientRequestsPage());

    renderTimeline();

    const emptyHeading = await screen.findByRole("heading", {
      level: 3,
      name: "You have no activity yet.",
    });
    const emptyState = emptyHeading.closest("section");

    expect(emptyState).toHaveClass("empty-state", "workspace-empty-state");
    expect(within(emptyState!).getByText("Nothing here yet")).toHaveClass(
      "eyebrow",
      "workspace-empty-state__eyebrow",
    );
    expect(
      within(emptyState!).getByText(
        "Recipes, saves, and ingredient requests you work with will appear here.",
      ),
    ).toBeVisible();
    expect(
      within(emptyState!).getByRole("link", { name: "Explore recipes" }),
    ).toHaveAttribute("href", "/recipes");
  });

  it("shows the member's trackable activity with relative times and destinations", async () => {
    renderTimeline();

    expect(
      await screen.findByRole("heading", { level: 1, name: "Activity" }),
    ).toBeVisible();
    expect(screen.queryByRole("link", { name: "Back to home" })).not.toBeInTheDocument();
    expect(screen.queryByText("Your Recipe Lab")).not.toBeInTheDocument();
    expect(screen.getByText("Updated draft")).toBeVisible();
    expect(screen.getByText("Banana oat pancakes")).toBeVisible();
    expect(screen.getByText("1 hour ago")).toBeVisible();
    const activityLink = screen.getByRole("link", {
      name: /Banana oat pancakes/,
    });
    expect(activityLink).toHaveAttribute("href", `/recipes/drafts/${DRAFT.id}`);
    expect(activityLink).toHaveClass("member-activity-page__event");
    expect(activityLink).toContainElement(screen.getByText("Updated draft"));
    expect(activityLink).toContainElement(
      screen.getByText("Your draft was saved."),
    );
    await waitFor(() => {
      expect(mocks.fetchMyRecipeLibrary).toHaveBeenCalledTimes(3);
      expect(mocks.fetchSavedRecipeLibrary).toHaveBeenCalledTimes(1);
      expect(mocks.browseMyIngredientRequests).toHaveBeenCalledTimes(1);
    });
  });

  it("filters the activity categories and shows accurate counts", async () => {
    mocks.fetchMyRecipeLibrary.mockImplementation(
      ({ view }: { view: "drafts" | "published" | "withdrawn" }) => {
        if (view === "drafts") {
          return Promise.resolve(libraryPage([draftLibraryItem(DRAFT)]));
        }
        if (view === "published") {
          return Promise.resolve(
            libraryPage([
              {
                kind: "published",
                recipe: RECIPE,
                visibility_state: "published",
              },
            ]),
          );
        }
        return Promise.resolve(
          libraryPage([
            {
              kind: "published",
              recipe: { ...RECIPE, id: "88888888-8888-4888-8888-888888888888" },
              visibility_state: "author_withdrawn",
            },
          ]),
        );
      },
    );
    mocks.fetchSavedRecipeLibrary.mockResolvedValue(
      savedLibraryPage([
        { recipe: SAVED_RECIPE, saved_at: "2026-08-29T12:00:00Z" },
      ]),
    );
    mocks.browseMyIngredientRequests.mockResolvedValue(
      ingredientRequestsPage([REVIEWED_REQUEST]),
    );

    renderTimeline();

    const all = await screen.findByRole("button", { name: "All" });
    const recipes = screen.getByRole("button", { name: "Recipes" });
    const saved = screen.getByRole("button", { name: "Saved" });
    const requests = screen.getByRole("button", {
      name: "Ingredient requests",
    });
    expect(all).toHaveTextContent("All5");
    expect(recipes).toHaveTextContent("Recipes3");
    expect(saved).toHaveTextContent("Saved1");
    expect(requests).toHaveTextContent("Ingredient requests1");
    expect(all).toHaveAttribute("aria-pressed", "true");
    const allHeader = screen
      .getByRole("heading", { level: 2, name: "All activity" })
      .closest("header");
    expect(allHeader).toHaveClass("workspace-panel-header");
    expect(allHeader).toHaveTextContent(
      "Recipes, saves, and ingredient requests you’ve worked with recently.",
    );
    expect(allHeader).toHaveTextContent("5 activity items");

    fireEvent.click(saved);
    expect(saved).toHaveAttribute("aria-pressed", "true");
    const savedHeader = screen
      .getByRole("heading", { level: 2, name: "Saved activity" })
      .closest("header");
    expect(savedHeader).toHaveClass("workspace-panel-header");
    expect(savedHeader).toHaveTextContent(
      "Recipes you’ve saved to come back to later.",
    );
    expect(savedHeader).toHaveTextContent("1 activity item");
    expect(screen.getByText(SAVED_RECIPE.title)).toBeVisible();
    expect(screen.queryByText(DRAFT.title)).not.toBeInTheDocument();
    expect(screen.queryByText(REVIEWED_REQUEST.proposed_name)).not.toBeInTheDocument();

    fireEvent.click(requests);
    expect(requests).toHaveAttribute("aria-pressed", "true");
    const requestsHeader = screen
      .getByRole("heading", { level: 2, name: "Ingredient request activity" })
      .closest("header");
    expect(requestsHeader).toHaveClass("workspace-panel-header");
    expect(requestsHeader).toHaveTextContent(
      "Ingredient requests that were reviewed by a curator.",
    );
    expect(requestsHeader).toHaveTextContent("1 activity item");
    expect(screen.getByText(REVIEWED_REQUEST.proposed_name)).toBeVisible();
    expect(screen.queryByText(SAVED_RECIPE.title)).not.toBeInTheDocument();
  });

  it("searches composed activity copy and shows the no-match state", async () => {
    mocks.fetchMyRecipeLibrary.mockImplementation(
      ({ view }: { view: "drafts" | "published" | "withdrawn" }) =>
        Promise.resolve(
          view === "drafts"
            ? libraryPage([draftLibraryItem(DRAFT)])
            : view === "published"
              ? libraryPage([
                  {
                    kind: "published",
                    recipe: RECIPE,
                    visibility_state: "published",
                  },
                ])
              : libraryPage(),
        ),
    );

    renderTimeline();

    const search = await screen.findByRole("searchbox", {
      name: "Search activity",
    });
    fireEvent.change(search, { target: { value: "  PUBLICLY AVAILABLE " } });
    expect(screen.getByText(RECIPE.title)).toBeVisible();
    expect(screen.queryByText(DRAFT.title)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "Updated draft" } });
    expect(screen.getByText(DRAFT.title)).toBeVisible();
    expect(screen.queryByText(RECIPE.title)).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: "not in this timeline" } });
    const emptyHeading = screen.getByRole("heading", {
      level: 3,
      name: "No activity matches your search.",
    });
    const emptyState = emptyHeading.closest("section");
    expect(emptyState).toHaveClass("empty-state", "workspace-empty-state");
    expect(within(emptyState!).getByText("No matches")).toHaveClass(
      "eyebrow",
      "workspace-empty-state__eyebrow",
    );
    expect(
      within(emptyState!).getByText(
        "Try a different search term or clear the search.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Banana oat pancakes/ }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(emptyState!).getByRole("button", { name: "Clear search" }),
    );
    expect(screen.getByText(RECIPE.title)).toBeVisible();
  });

  it("suppresses date groups that have no matches", async () => {
    mocks.fetchMyRecipeLibrary.mockImplementation(
      ({ view }: { view: "drafts" | "published" | "withdrawn" }) =>
        Promise.resolve(
          view === "drafts"
            ? libraryPage([draftLibraryItem(DRAFT)])
            : view === "published"
              ? libraryPage([
                  {
                    kind: "published",
                    recipe: RECIPE,
                    visibility_state: "published",
                  },
                ])
              : libraryPage(),
        ),
    );
    mocks.fetchSavedRecipeLibrary.mockResolvedValue(
      savedLibraryPage([
        { recipe: SAVED_RECIPE, saved_at: "2026-08-29T12:00:00Z" },
      ]),
    );

    renderTimeline();

    expect(
      await screen.findByRole("heading", { level: 2, name: "Today" }),
    ).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Yesterday" })).toBeVisible();
    expect(screen.getByRole("heading", { level: 2, name: "Earlier" })).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Saved" }));
    expect(screen.queryByRole("heading", { level: 2, name: "Today" })).toBeNull();
    expect(screen.getByRole("heading", { level: 2, name: "Yesterday" })).toBeVisible();
    expect(screen.queryByRole("heading", { level: 2, name: "Earlier" })).toBeNull();
  });

  it("reveals older activity in stable increments", async () => {
    const drafts = Array.from({ length: 13 }, (_, index) => ({
      ...DRAFT,
      id: `99999999-9999-4999-8999-${String(index + 1).padStart(12, "0")}`,
      title: `Activity draft ${index + 1}`,
      updated_at: new Date(
        Date.parse("2026-08-30T15:00:00Z") - index * 60_000,
      ).toISOString(),
    }));
    mocks.fetchMyRecipeLibrary.mockImplementation(
      ({ view }: { view: "drafts" | "published" | "withdrawn" }) =>
        Promise.resolve(
          view === "drafts"
            ? libraryPage(drafts.map(draftLibraryItem))
            : libraryPage(),
        ),
    );

    renderTimeline();

    const loadOlder = await screen.findByRole("button", {
      name: "Load older activity",
    });
    expect(
      screen.getAllByRole("link", { name: /Activity draft/ }),
    ).toHaveLength(12);

    fireEvent.click(loadOlder);
    expect(
      screen.getAllByRole("link", { name: /Activity draft/ }),
    ).toHaveLength(13);
    expect(
      screen.queryByRole("button", { name: "Load older activity" }),
    ).not.toBeInTheDocument();
  });

  it("keeps activity from successful sources and shows one generic recovery action", async () => {
    mocks.fetchSavedRecipeLibrary.mockRejectedValue(
      new Error("saved recipe endpoint failed"),
    );

    render(
      <AuthSessionProvider
        initialSession={{ status: "authenticated", user: MEMBER }}
      >
        <MemberActivityTimeline />
      </AuthSessionProvider>,
    );

    expect(await screen.findByText("Updated draft")).toBeVisible();
    expect(screen.getByText("Banana oat pancakes")).toBeVisible();

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Some activity is unavailable right now.");
    expect(alert).not.toHaveTextContent("saved recipe endpoint failed");
    expect(within(alert).getAllByRole("button")).toHaveLength(1);
    expect(
      within(alert).getByRole("button", { name: "Try again" }),
    ).toBeVisible();
  });

  it("retries all activity sources from the single recovery action", async () => {
    mocks.fetchSavedRecipeLibrary
      .mockRejectedValueOnce(new Error("saved recipe endpoint failed"))
      .mockResolvedValue(savedPage);

    render(
      <AuthSessionProvider
        initialSession={{ status: "authenticated", user: MEMBER }}
      >
        <MemberActivityTimeline />
      </AuthSessionProvider>,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );

    expect(
      screen.getByRole("button", { name: "Trying again…" }),
    ).toBeDisabled();
    await waitFor(() => {
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
    expect(mocks.fetchSavedRecipeLibrary).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Updated draft")).toBeVisible();
  });

  it("automatically retries a transient activity read once", async () => {
    mocks.browseMyIngredientRequests
      .mockRejectedValueOnce({ status: 503 })
      .mockResolvedValue(ingredientRequestPage);

    render(
      <AuthSessionProvider
        initialSession={{ status: "authenticated", user: MEMBER }}
      >
        <MemberActivityTimeline />
      </AuthSessionProvider>,
    );

    expect(await screen.findByText("Updated draft")).toBeVisible();
    await waitFor(() => {
      expect(mocks.browseMyIngredientRequests).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps the activity private for anonymous visitors", () => {
    render(
      <AuthSessionProvider initialSession={{ status: "anonymous" }}>
        <MemberActivityTimeline />
      </AuthSessionProvider>,
    );

    expect(
      screen.getByRole("heading", { level: 1, name: "Page Unavailable" }),
    ).toBeVisible();
    expect(mocks.fetchMyRecipeLibrary).not.toHaveBeenCalled();
  });
});
