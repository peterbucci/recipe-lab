import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  anonymous,
  authenticated,
  CATALOG_ID,
  cleanupRecipeLibraryViewMocks,
  FORK_ID,
  original,
  profile,
} from "./recipe-library-views-test-support";
import CookProfileError from "../cooks/[handle]/error";
import CookProfileLoading from "../cooks/[handle]/loading";
import CookProfileNotFound from "../cooks/[handle]/not-found";
import { CookProfileView } from "./cook-profile-view";
afterEach(cleanupRecipeLibraryViewMocks);

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
});

