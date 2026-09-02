import Link from "next/link";

import type { PublicCookProfilePage } from "../../lib/recipe-library-api";
import { CookFollowControl } from "./cook-follow-control";
import { RecipeCard } from "./recipe-card";
import { RecipeCardViewerStateProvider } from "./recipe-card-engagement";

interface CookProfileViewProps {
  data: PublicCookProfilePage;
}

function profileHref(handle: string, page: number): string {
  const pathname = `/cooks/${encodeURIComponent(handle)}`;
  return page <= 1 ? pathname : `${pathname}?${new URLSearchParams({ page: String(page) })}`;
}

export function CookProfileView({ data }: CookProfileViewProps) {
  const beyondLastPage = data.total > 0 && data.items.length === 0;

  return (
    <>
      <header className="cook-profile__header">
        <span className="cook-profile__avatar" aria-hidden="true">
          {data.cook.display_name.trim().slice(0, 1).toLocaleUpperCase() || "C"}
        </span>
        <div className="cook-profile__identity">
          <h1>{data.cook.display_name}</h1>
          <CookFollowControl
            cookId={data.cook.id}
            displayName={data.cook.display_name}
            handle={data.cook.handle}
            initialFollowerCount={data.follower_count}
            profileDescription={data.description}
            recipeCount={data.total}
            variant="profile"
          />
        </div>
      </header>

      <section className="cook-profile__recipes" aria-labelledby="cook-recipes-heading">
        <div className="section-heading section-heading--compact">
          <h2 id="cook-recipes-heading">Recipes</h2>
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
          <RecipeCardViewerStateProvider
            key={data.items.map((recipe) => recipe.id).join(":")}
            recipeVersionIds={data.items.map((recipe) => recipe.id)}
          >
            <ul
              className="recipe-grid"
              aria-label={`Public recipes by ${data.cook.display_name}`}
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
                />
              ))}
            </ul>
          </RecipeCardViewerStateProvider>
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
