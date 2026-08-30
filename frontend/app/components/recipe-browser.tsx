import Link from "next/link";

import { recipeBrowseHref } from "../../lib/recipe-browse-query";
import type { RecipeCategory, RecipePage } from "../../lib/recipe-api";
import { Pagination } from "./pagination";
import { RecipeCard } from "./recipe-card";
import { RecipeSearch } from "./recipe-search";

interface RecipeBrowserProps {
  category?: RecipeCategory;
  data: RecipePage;
  query: string;
  sort?: "newest" | "title";
}

function emptyHeading(query: string, category?: RecipeCategory): string {
  if (category) {
    return query
      ? `No ${category.name.toLocaleLowerCase("en-US")} recipes matched that search.`
      : `No ${category.name.toLocaleLowerCase("en-US")} recipes are available yet.`;
  }
  if (query) {
    return "No recipes matched that search.";
  }
  return "No recipes are available yet.";
}

function emptyMessage(query: string, category?: RecipeCategory): string {
  if (query) {
    return "Try a broader recipe title or a word from the description.";
  }
  if (category) {
    return "Recipes will appear here when an author publishes one in this category.";
  }
  return "Recipes will appear here when they are added.";
}

function resultsHeading(query: string, category?: RecipeCategory): string {
  if (category && query) {
    return `${category.name} recipes matching “${query}”`;
  }
  if (category) {
    return `${category.name} recipes`;
  }
  return query ? `Results for “${query}”` : "Recipes";
}

export function RecipeBrowser({ category, data, query, sort }: RecipeBrowserProps) {
  const beyondLastPage = data.total > 0 && data.items.length === 0;
  const filters = { category: category?.slug, sort };

  return (
    <div className="catalog-dashboard">
      <header className="page-intro catalog-dashboard__intro">
        <div className="catalog-dashboard__intro-copy">
          <h1>Find something to cook</h1>
          <p>Search by name or description, then open the recipe that sounds good.</p>
        </div>

        <div className="catalog-toolbar catalog-dashboard__search-panel">
          <RecipeSearch
            ariaLabel="Search recipe catalog"
            category={category?.slug}
            idPrefix="catalog-recipe-search"
            query={query}
            sort={sort}
          />
        </div>
      </header>

      <section
        className="catalog-results catalog-dashboard__results"
        aria-labelledby="catalog-results-heading"
      >
        <div className="section-heading section-heading--compact catalog-results__heading">
          <div>
            <h2 id="catalog-results-heading">
              {resultsHeading(query, category)}
            </h2>
            <p className="result-count" aria-live="polite">
              {data.total} {data.total === 1 ? "recipe" : "recipes"}
            </p>
            {category ? (
              <p className="catalog-results__active-filter">
                Category: <strong>{category.name}</strong>{" "}
                <Link href={recipeBrowseHref(1, query, { sort })}>Clear category</Link>
              </p>
            ) : null}
          </div>
        </div>

        <div className="catalog-results__body">
          {data.total === 0 ? (
            <div className="empty-state catalog-results__empty">
              <h3>{emptyHeading(query, category)}</h3>
              <p>{emptyMessage(query, category)}</p>
              {query ? (
                <Link
                  className="button button--secondary"
                  href={recipeBrowseHref(1, "", filters)}
                >
                  Clear search
                </Link>
              ) : null}
            </div>
          ) : beyondLastPage ? (
            <div className="empty-state catalog-results__empty catalog-results__empty--stale">
              <h3>That page is beyond the results.</h3>
              <p>The collection currently has {data.total_pages} pages of recipes.</p>
              <Link
                className="button button--secondary"
                href={recipeBrowseHref(1, query, filters)}
              >
                Return to the first page
              </Link>
            </div>
          ) : (
            <ul className="recipe-grid catalog-results__grid" aria-label="Recipe results">
              {data.items.map((recipe) => (
                <RecipeCard key={recipe.id} recipe={recipe} />
              ))}
            </ul>
          )}
        </div>

        {!beyondLastPage ? (
          <Pagination
            currentPage={data.page}
            category={category?.slug}
            query={query}
            sort={sort}
            totalPages={data.total_pages}
          />
        ) : null}
      </section>
    </div>
  );
}
