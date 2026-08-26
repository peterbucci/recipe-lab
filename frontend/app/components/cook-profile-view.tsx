import Link from "next/link";

import type { PublicCookProfilePage } from "../../lib/recipe-library-api";
import { RecipeCard } from "./recipe-card";

interface CookProfileViewProps {
  data: PublicCookProfilePage;
}

function profileHref(handle: string, page: number): string {
  const pathname = `/cooks/${encodeURIComponent(handle)}`;
  return page <= 1 ? pathname : `${pathname}?${new URLSearchParams({ page: String(page) })}`;
}

export function CookProfileView({ data }: CookProfileViewProps) {
  const beyondLastPage = data.total > 0 && data.items.length === 0;
  const recipeLabel = data.total === 1 ? "public recipe" : "public recipes";

  return (
    <>
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/recipes">← All recipes</Link>
      </nav>
      <header className="cook-profile__header">
        <span className="cook-profile__avatar" aria-hidden="true">
          {data.cook.display_name.trim().slice(0, 1).toLocaleUpperCase() || "C"}
        </span>
        <div>
          <p className="eyebrow">Cook profile</p>
          <h1>{data.cook.display_name}</h1>
          <p className="cook-profile__handle">@{data.cook.handle}</p>
          <p className="cook-profile__count">
            {data.total} {recipeLabel}
          </p>
        </div>
      </header>

      <section className="cook-profile__recipes" aria-labelledby="cook-recipes-heading">
        <div className="section-heading section-heading--compact">
          <div>
            <h2 id="cook-recipes-heading">Recipes by {data.cook.display_name}</h2>
            <p className="result-count" aria-live="polite">
              Only publicly readable versions appear here.
            </p>
          </div>
        </div>

        {data.total === 0 ? (
          <div className="empty-state">
            <h3>No public recipes yet.</h3>
            <p>This cook does not have a publicly readable recipe version right now.</p>
            <Link className="button button--secondary" href="/recipes">
              Browse all recipes
            </Link>
          </div>
        ) : beyondLastPage ? (
          <div className="empty-state">
            <h3>That page is beyond this cook’s recipes.</h3>
            <p>The public collection currently has {data.total_pages} pages.</p>
            <Link className="button button--secondary" href={profileHref(data.cook.handle, 1)}>
              Return to the first page
            </Link>
          </div>
        ) : (
          <ul className="recipe-grid" aria-label={`Public recipes by ${data.cook.display_name}`}>
            {data.items.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </ul>
        )}
      </section>

      {!beyondLastPage && data.total_pages > 1 ? (
        <nav className="pagination" aria-label={`Recipe pages for ${data.cook.display_name}`}>
          {data.page > 1 ? (
            <Link
              className="button button--secondary"
              href={profileHref(data.cook.handle, data.page - 1)}
            >
              ← Previous
            </Link>
          ) : (
            <span className="button button--disabled" aria-disabled="true">
              ← Previous
            </span>
          )}
          <span className="pagination__status" aria-current="page">
            Page {data.page} of {data.total_pages}
          </span>
          {data.page < data.total_pages ? (
            <Link
              className="button button--secondary"
              href={profileHref(data.cook.handle, data.page + 1)}
            >
              Next →
            </Link>
          ) : (
            <span className="button button--disabled" aria-disabled="true">
              Next →
            </span>
          )}
        </nav>
      ) : null}
    </>
  );
}
