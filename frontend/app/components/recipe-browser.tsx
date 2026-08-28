import Link from "next/link";

import { recipeBrowseHref } from "../../lib/recipe-browse-query";
import type { RecipePage } from "../../lib/recipe-api";
import { Pagination } from "./pagination";
import { RecipeCard } from "./recipe-card";
import { RecipeSearch } from "./recipe-search";

interface RecipeBrowserProps {
  data: RecipePage;
  query: string;
}

function emptyHeading(query: string): string {
  if (query) {
    return "No recipes matched that search.";
  }
  return "No recipes are available yet.";
}

function emptyMessage(query: string): string {
  if (query) {
    return "Try a broader recipe title or a word from the description.";
  }
  return "Recipes will appear here when they are added.";
}

export function RecipeBrowser({ data, query }: RecipeBrowserProps) {
  const beyondLastPage = data.total > 0 && data.items.length === 0;

  return (
    <>
      <header className="page-intro">
        <h1>Find something to cook</h1>
        <p>Search by name or description, then open the recipe that sounds good.</p>
      </header>

      <div className="catalog-toolbar">
        <RecipeSearch query={query} />
      </div>

      <section className="catalog-results" aria-labelledby="catalog-results-heading">
        <div className="section-heading section-heading--compact catalog-results__heading">
          <div>
            <h2 id="catalog-results-heading">
              {query ? `Results for “${query}”` : "Recipes"}
            </h2>
            <p className="result-count" aria-live="polite">
              {data.total} {data.total === 1 ? "recipe" : "recipes"}
            </p>
          </div>
        </div>

        {data.total === 0 ? (
          <div className="empty-state">
            <h3>{emptyHeading(query)}</h3>
            <p>{emptyMessage(query)}</p>
            {query ? (
              <Link className="button button--secondary" href={recipeBrowseHref(1, "")}>
                Clear search
              </Link>
            ) : null}
          </div>
        ) : beyondLastPage ? (
          <div className="empty-state">
            <h3>That page is beyond the results.</h3>
            <p>The collection currently has {data.total_pages} pages of recipes.</p>
            <Link
              className="button button--secondary"
              href={recipeBrowseHref(1, query)}
            >
              Return to the first page
            </Link>
          </div>
        ) : (
          <ul className="recipe-grid" aria-label="Recipe results">
            {data.items.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </ul>
        )}
      </section>

      {!beyondLastPage ? (
        <Pagination
          currentPage={data.page}
          query={query}
          totalPages={data.total_pages}
        />
      ) : null}
    </>
  );
}
