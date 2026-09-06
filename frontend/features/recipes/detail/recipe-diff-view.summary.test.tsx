import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  articleNamed,
  baseVersion,
  mixedDiff,
  sectionNamed,
  targetVersion,
} from "./recipe-diff-view-test-support";
import { RecipeDiffView } from "./recipe-diff-view";

describe("RecipeDiffView", () => {
  it("leads with a cooking-first summary and orders changes by cooking flow", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    expect(
      screen.getByRole("heading", {
        name: "How Lower-Sugar Pecan Carrot Cake changed",
        level: 1,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Compared with Carrot Walnut Snack Cake. Start with the main cooking changes, then review every recorded detail below.",
      ),
    ).toBeInTheDocument();

    const highlights = screen.getByRole("list", {
      name: "Changes at a glance",
    });
    expect(
      within(highlights).getByText("Use 90 g Pecan instead of 100 g Walnut."),
    ).toBeInTheDocument();
    expect(
      within(highlights).getByText("Change White sugar from 180 g to 140 g."),
    ).toBeInTheDocument();
    expect(
      within(highlights).getByText("Add Orange zest (1 tbsp)."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("7 more changes are listed below."),
    ).toBeInTheDocument();

    const versions = screen.getByRole("navigation", {
      name: "Compared recipes",
    });
    expect(
      within(versions).getByRole("link", {
        name: /starting recipe.*carrot walnut snack cake/i,
      }),
    ).toHaveAttribute("href", `/recipes/${baseVersion.id}`);
    expect(
      within(versions).getByRole("link", {
        name: /this recipe.*lower-sugar pecan carrot cake/i,
      }),
    ).toHaveAttribute("href", `/recipes/${targetVersion.id}`);
    expect(screen.queryByText(/version \d+/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/direct parent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/before · parent/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/after · variant/i)).not.toBeInTheDocument();

    expect(
      screen
        .getAllByRole("heading", { level: 2 })
        .map((heading) => heading.textContent),
    ).toEqual([
      "Changes at a glance",
      "Ingredient changes",
      "Cooking step changes",
      "Recipe details",
    ]);
    expect(document.body).not.toHaveTextContent(/Catalog name:/i);
    expect(document.body).not.toHaveTextContent(/Ingredient \d+:/i);
    expect(document.body).not.toHaveTextContent(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
  });

  it("labels every comparison article with its visible heading", () => {
    render(<RecipeDiffView diff={mixedDiff()} />);

    const articles = screen.getAllByRole("article");
    expect(articles).toHaveLength(11);
    for (const article of articles) {
      expect(article).toHaveAccessibleName();
      const labelledBy = article.getAttribute("aria-labelledby");
      expect(labelledBy).not.toBeNull();
      expect(document.getElementById(labelledBy!)).toBe(
        article.querySelector(":scope > h1, :scope > header h1, :scope > h3"),
      );
    }

    expect(
      articleNamed("How Lower-Sugar Pecan Carrot Cake changed"),
    ).toBeInTheDocument();
    expect(articleNamed("Use Pecan instead of Walnut")).toBeInTheDocument();
    expect(articleNamed("Update step 2")).toBeInTheDocument();
    expect(articleNamed("Title")).toBeInTheDocument();
  });

  it("uses singular summary and highlight labels for one change", () => {
    const diff = mixedDiff();
    diff.metadata_changes = [diff.metadata_changes[2]];
    diff.ingredients = { added: [], removed: [], replaced: [], modified: [] };
    diff.instructions = { added: [], removed: [], modified: [] };

    render(<RecipeDiffView diff={diff} />);

    const overview = sectionNamed("Changes at a glance");
    expect(
      within(overview).getByText("1 change", { exact: true }),
    ).toBeInTheDocument();
    const highlights = screen.getByRole("list", {
      name: "Changes at a glance",
    });
    expect(
      within(highlights).getByText(
        "Change yield from 8 servings to 6 servings.",
      ),
    ).toBeInTheDocument();
    expect(
      within(highlights).queryByText(/ingredient/i),
    ).not.toBeInTheDocument();
    expect(
      within(highlights).queryByText(/cooking step/i),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Recipe details" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Ingredient changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Cooking step changes" }),
    ).not.toBeInTheDocument();
  });

  it("renders an honest no-change state without empty change groups", () => {
    const diff = mixedDiff();
    diff.metadata_changes = [];
    diff.ingredients = { added: [], removed: [], replaced: [], modified: [] };
    diff.instructions = { added: [], removed: [], modified: [] };
    diff.has_changes = false;

    render(<RecipeDiffView diff={diff} />);

    expect(
      screen.getByRole("heading", {
        name: "This recipe matches the starting recipe.",
        level: 2,
      }),
    ).toBeInTheDocument();
    expect(
      screen
        .getByRole("heading", {
          name: "This recipe matches the starting recipe.",
        })
        .closest("section"),
    ).toHaveTextContent(
      "It has the same recipe details, ingredients, and cooking steps as Carrot Walnut Snack Cake.",
    );
    expect(
      screen.queryByRole("heading", { name: "Ingredient changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Cooking step changes" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Recipe details" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("list", { name: "Changes at a glance" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/^0 changes?$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\boriginal\b/i)).not.toBeInTheDocument();
  });
});

