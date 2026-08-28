import Link from "next/link";

import {
  isVariantForRecipeBrowseType,
  recipeBrowseHref,
  type RecipeBrowseType,
} from "../../lib/recipe-browse-query";
import type { RecipePage } from "../../lib/recipe-api";
import { Pagination } from "./pagination";
import { RecipeCard } from "./recipe-card";
import { RecipeSearch } from "./recipe-search";

interface RecipeBrowserProps {
  data: RecipePage;
  query: string;
  recipeType: RecipeBrowseType;
}

interface RecipeFilter {
  label: string;
  recipeType: RecipeBrowseType;
}

const recipeFilters: RecipeFilter[] = [
  { label: "All", recipeType: "all" },
  { label: "Originals", recipeType: "originals" },
  { label: "Versions", recipeType: "versions" },
];

function emptyHeading(query: string, isVariant?: boolean): string {
  if (query) {
    return "No recipes matched that search.";
  }
  if (isVariant === true) {
    return "No versions are available yet.";
  }
  if (isVariant === false) {
    return "No original recipes are available yet.";
  }
  return "No recipes are available yet.";
}

function emptyMessage(query: string, isVariant?: boolean): string {
  if (query) {
    return "Try a broader recipe title or a word from the description.";
  }
  if (isVariant !== undefined) {
    return "Choose another filter to see the recipes that are available.";
  }
  return "Recipes will appear here when they are added.";
}

export function RecipeBrowser({ data, query, recipeType }: RecipeBrowserProps) {
  const beyondLastPage = data.total > 0 && data.items.length === 0;
  const isVariant = isVariantForRecipeBrowseType(recipeType);

  return (
    <>
      <header className="page-intro">
        <h1>Find something to cook</h1>
        <p>Search by name or description, then open the recipe that sounds good.</p>
      </header>

      <div className="catalog-toolbar">
        <RecipeSearch query={query} recipeType={recipeType} />
        <nav className="button-row recipe-filters" aria-label="Recipe type">
          {recipeFilters.map((filter) => {
            const active = filter.recipeType === recipeType;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`button ${active ? "button--primary" : "button--secondary"}`}
                href={recipeBrowseHref(1, query, filter.recipeType)}
                key={filter.label}
              >
                {filter.label}
              </Link>
            );
          })}
        </nav>
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
            <h3>{emptyHeading(query, isVariant)}</h3>
            <p>{emptyMessage(query, isVariant)}</p>
            {query ? (
              <Link
                className="button button--secondary"
                href={recipeBrowseHref(1, "", recipeType)}
              >
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
              href={recipeBrowseHref(1, query, recipeType)}
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
          recipeType={recipeType}
          totalPages={data.total_pages}
        />
      ) : null}
    </>
  );
}
