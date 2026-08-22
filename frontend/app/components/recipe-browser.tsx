import Link from "next/link";

import type { RecipePage } from "../../lib/recipe-api";
import { pageHref, Pagination } from "./pagination";
import { RecipeCard } from "./recipe-card";
import { RecipeSearch } from "./recipe-search";

interface RecipeBrowserProps {
  data: RecipePage;
  query: string;
}

export function RecipeBrowser({ data, query }: RecipeBrowserProps) {
  const beyondLastPage = data.total > 0 && data.items.length === 0;

  return (
    <>
      <header className="page-intro">
        <p className="eyebrow">Recipe catalog</p>
        <h1>Find a recipe worth making your own.</h1>
        <p>
          Browse complete recipes and the variations cooks made from them. Pick a starting point,
          then see what each cook changed.
        </p>
      </header>

      <RecipeSearch query={query} />

      <section className="catalog-results" aria-labelledby="catalog-results-heading">
        <div className="section-heading section-heading--compact">
          <div>
            <p className="eyebrow">Recipes and variations</p>
            <h2 id="catalog-results-heading">
              {query ? `Results for “${query}”` : "Explore every recipe"}
            </h2>
          </div>
          <p className="result-count" aria-live="polite">
            {data.total} {data.total === 1 ? "recipe" : "recipes and variations"}
          </p>
        </div>

        {data.total === 0 ? (
          <div className="empty-state">
            <h3>{query ? "No recipes matched that search." : "The catalog is empty."}</h3>
            <p>
              {query
                ? "Try a broader recipe title or a word from the description."
                : "Recipes will appear here as soon as the public demo catalog is loaded."}
            </p>
            {query ? (
              <Link className="button button--secondary" href="/recipes">
                Clear search
              </Link>
            ) : null}
          </div>
        ) : beyondLastPage ? (
          <div className="empty-state">
            <h3>That page is beyond the catalog.</h3>
            <p>The collection currently has {data.total_pages} pages of recipes.</p>
            <Link className="button button--secondary" href={pageHref(1, query)}>
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
        <Pagination currentPage={data.page} query={query} totalPages={data.total_pages} />
      ) : null}
    </>
  );
}
