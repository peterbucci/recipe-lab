import Link from "next/link";

import {
  recipeBrowseHref,
  type RecipeBrowseType,
} from "../../lib/recipe-browse-query";
import type { RecipeCategory, RecipePage } from "../../lib/recipe-api";
import { CatalogCategoryRetry } from "./catalog-category-retry";
import { Pagination } from "./pagination";
import { RecipeCatalogFilters } from "./recipe-catalog-filters";
import { RecipeCard } from "./recipe-card";
import { RecipeCardViewerStateProvider } from "./recipe-card-engagement";

interface RecipeBrowserProps {
  categories?: readonly RecipeCategory[];
  categoriesUnavailable?: boolean;
  category?: RecipeCategory;
  categorySlug?: string;
  data: RecipePage;
  query: string;
  recipeType?: RecipeBrowseType;
  sort?: "newest" | "title";
}

function emptyHeading(
  query: string,
  category?: RecipeCategory,
  recipeType?: RecipeBrowseType,
  categoryFilterActive = false,
): string {
  if (category) {
    return query
      ? `No ${category.name.toLocaleLowerCase("en-US")} recipes matched that search.`
      : `No ${category.name.toLocaleLowerCase("en-US")} recipes are available yet.`;
  }
  if (query) {
    return categoryFilterActive
      ? "No recipes in this category matched that search."
      : "No recipes matched that search.";
  }
  if (categoryFilterActive) {
    return "No recipes are available in this category yet.";
  }
  if (recipeType === "originals") {
    return "No original recipes are available yet.";
  }
  if (recipeType === "versions") {
    return "No recipe versions are available yet.";
  }
  return "No recipes are available yet.";
}

function emptyMessage(
  query: string,
  category?: RecipeCategory,
  categoryFilterActive = false,
): string {
  if (query) {
    return "Try a broader recipe title or a word from the description.";
  }
  if (category || categoryFilterActive) {
    return "Recipes will appear here when an author publishes one in this category.";
  }
  return "Recipes will appear here when they are added.";
}

function resultsHeading(
  query: string,
  category?: RecipeCategory,
  recipeType?: RecipeBrowseType,
  categoryFilterActive = false,
): string {
  const recipeLabel =
    recipeType === "originals"
      ? "original recipes"
      : recipeType === "versions"
        ? "recipe versions"
        : "recipes";
  let heading: string;
  if (category) {
    heading = `${category.name} ${recipeLabel}`;
  } else if (categoryFilterActive) {
    heading =
      recipeType === "originals"
        ? "Original recipes in this category"
        : recipeType === "versions"
          ? "Recipe versions in this category"
          : "Recipes in this category";
  } else {
    heading =
      recipeType === "originals"
        ? "Original recipes"
        : recipeType === "versions"
          ? "Recipe versions"
          : "All recipes";
  }
  return query ? `${heading} matching “${query}”` : heading;
}

function resultCountLabel(
  total: number,
  recipeType?: RecipeBrowseType,
): string {
  if (recipeType === "originals") {
    return `${total} public original ${total === 1 ? "recipe" : "recipes"}`;
  }
  if (recipeType === "versions") {
    return `${total} public recipe ${total === 1 ? "version" : "versions"}`;
  }
  return `${total} public ${total === 1 ? "recipe" : "recipes"}`;
}

export function RecipeBrowser({
  categories = [],
  categoriesUnavailable = false,
  category,
  categorySlug,
  data,
  query,
  recipeType,
  sort,
}: RecipeBrowserProps) {
  const beyondLastPage = data.total > 0 && data.items.length === 0;
  const activeCategorySlug = category?.slug ?? categorySlug;
  const categoryFilterActive = Boolean(activeCategorySlug);
  const filters = { category: activeCategorySlug, recipeType, sort };

  return (
    <div className="catalog-dashboard">
      <section className="catalog-filter-panel" aria-label="Explore filters">
        <nav className="catalog-category-strip" aria-label="Recipe categories">
          <Link
            aria-current={categoryFilterActive ? undefined : "page"}
            className="catalog-category-pill"
            href={recipeBrowseHref(1, query, { recipeType, sort })}
          >
            All categories
          </Link>
          {categoriesUnavailable ? (
            <span className="catalog-category-unavailable" role="status">
              <span>Category filters are unavailable.</span>
              <CatalogCategoryRetry />
            </span>
          ) : (
            categories.map((item) => (
              <Link
                aria-current={category?.id === item.id ? "page" : undefined}
                className="catalog-category-pill"
                href={recipeBrowseHref(1, query, {
                  category: item.slug,
                  recipeType,
                  sort,
                })}
                key={item.id}
              >
                {item.name}
              </Link>
            ))
          )}
        </nav>

        <RecipeCatalogFilters
          category={activeCategorySlug}
          query={query}
          recipeType={recipeType}
          sort={sort ?? "newest"}
        />
      </section>

      <section
        className="catalog-results catalog-dashboard__results"
        aria-labelledby="catalog-results-heading"
      >
        <div className="section-heading catalog-results__heading">
          <div>
            <h1 id="catalog-results-heading">
              {resultsHeading(
                query,
                category,
                recipeType,
                categoryFilterActive,
              )}
            </h1>
            <p className="result-count" aria-live="polite">
              {resultCountLabel(data.total, recipeType)}
            </p>
          </div>
          {query && data.total > 0 ? (
            <Link
              className="catalog-results__clear-search"
              href={recipeBrowseHref(1, "", filters)}
            >
              Clear search
            </Link>
          ) : null}
        </div>

        <div className="catalog-results__body">
          {data.total === 0 ? (
            <div className="empty-state catalog-results__empty">
              <h2>
                {emptyHeading(
                  query,
                  category,
                  recipeType,
                  categoryFilterActive,
                )}
              </h2>
              <p>{emptyMessage(query, category, categoryFilterActive)}</p>
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
              <h2>That page is beyond the results.</h2>
              <p>
                The collection currently has {data.total_pages} pages of
                recipes.
              </p>
              <Link
                className="button button--secondary"
                href={recipeBrowseHref(1, query, filters)}
              >
                Return to the first page
              </Link>
            </div>
          ) : (
            <RecipeCardViewerStateProvider
              key={data.items.map((recipe) => recipe.id).join(":")}
              recipeVersionIds={data.items.map((recipe) => recipe.id)}
            >
              <ul
                className="recipe-grid catalog-results__grid"
                aria-label="Recipe results"
              >
                {data.items.map((recipe) => (
                  <RecipeCard
                    engagement={{
                      averageRating: recipe.average_rating,
                      ratingCount: recipe.rating_count,
                      saveCount: recipe.save_count,
                    }}
                    key={recipe.id}
                    recipe={recipe}
                    showEngagementDescription
                  />
                ))}
              </ul>
            </RecipeCardViewerStateProvider>
          )}
        </div>

        {!beyondLastPage ? (
          <Pagination
            currentPage={data.page}
            category={activeCategorySlug}
            query={query}
            recipeType={recipeType}
            sort={sort}
            totalPages={data.total_pages}
          />
        ) : null}
      </section>
    </div>
  );
}
