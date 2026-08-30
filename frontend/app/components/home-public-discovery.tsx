import Link from "next/link";

import {
  fetchFeaturedRecipes,
  fetchRecipeCategories,
  fetchRecipePage,
  type FeaturedRecipeList,
  type RecipeCategoryList,
  type RecipePage,
} from "../../lib/recipe-api";
import { PublicCookAttribution } from "./public-cook-attribution";
import { RecipeCard } from "./recipe-card";

const COMMUNITY_FEED_SIZE = 5;
const FEATURED_RECIPE_LIMIT = 4;

function publishedAt(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    return null;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
}

function publicResult<T>(result: PromiseSettledResult<T>): T | null {
  return result.status === "fulfilled" ? result.value : null;
}

function FeaturedRecipes({ data }: { data: FeaturedRecipeList | null }) {
  return (
    <section
      className="home-content-section home-featured-recipes"
      aria-labelledby="home-featured-heading"
    >
      <header className="home-content-section__heading">
        <div>
          <p className="eyebrow">Editor selection</p>
          <h2 id="home-featured-heading">Featured recipes</h2>
        </div>
        <Link className="text-link" href="/recipes">
          Explore all recipes
        </Link>
      </header>

      {data === null ? (
        <div className="home-section-state" role="status">
          <p>Featured recipes are unavailable right now.</p>
          <Link href="/" prefetch={false} replace>
            Retry featured recipes
          </Link>
        </div>
      ) : data.items.length === 0 ? (
        <div className="home-section-state">
          <p>No recipes are featured right now.</p>
          <Link href="/recipes">Browse the full recipe collection</Link>
        </div>
      ) : (
        <ul className="recipe-grid home-featured-recipes__grid" aria-label="Featured recipes">
          {data.items.slice(0, FEATURED_RECIPE_LIMIT).map((recipe) => (
            <RecipeCard key={recipe.id} recipe={recipe} />
          ))}
        </ul>
      )}
    </section>
  );
}

function RecipeCategories({ data }: { data: RecipeCategoryList | null }) {
  return (
    <section
      className="home-content-section home-recipe-categories"
      aria-labelledby="home-categories-heading"
    >
      <header className="home-content-section__heading home-content-section__heading--compact">
        <div>
          <p className="eyebrow">Curated paths</p>
          <h2 id="home-categories-heading">Explore by category</h2>
        </div>
      </header>

      {data === null ? (
        <div className="home-section-state" role="status">
          <p>Categories are unavailable right now.</p>
          <Link href="/" prefetch={false} replace>
            Retry recipe categories
          </Link>
        </div>
      ) : data.items.length === 0 ? (
        <div className="home-section-state">
          <p>There are no active categories yet.</p>
          <Link href="/recipes">Explore every recipe</Link>
        </div>
      ) : (
        <nav className="home-category-links" aria-label="Recipe categories">
          {data.items.map((category) => (
            <Link
              key={category.id}
              className="home-category-link"
              href={`/recipes?category=${encodeURIComponent(category.slug)}`}
            >
              {category.name}
            </Link>
          ))}
        </nav>
      )}
    </section>
  );
}

function CommunityFeed({ data }: { data: RecipePage | null }) {
  return (
    <section
      className="home-content-section home-community-feed"
      aria-labelledby="home-community-heading"
    >
      <header className="home-content-section__heading">
        <div>
          <p className="eyebrow">Recently published</p>
          <h2 id="home-community-heading">From the community</h2>
        </div>
        <Link className="text-link" href="/recipes?sort=newest">
          See recent recipes
        </Link>
      </header>

      {data === null ? (
        <div className="home-section-state" role="status">
          <p>Recent community recipes are unavailable right now.</p>
          <Link href="/" prefetch={false} replace>
            Retry community recipes
          </Link>
        </div>
      ) : data.items.length === 0 ? (
        <div className="home-section-state">
          <p>Nothing has been published yet.</p>
          <Link href="/recipes/new">Create the first recipe</Link>
        </div>
      ) : (
        <ol className="home-community-feed__list">
          {data.items.map((recipe) => {
            const publicationDate = publishedAt(recipe.published_at);
            return (
              <li key={recipe.id} className="home-community-feed__item">
                <span className="home-community-feed__avatar" aria-hidden="true">
                  {recipe.author.display_name.trim().charAt(0).toUpperCase() || "R"}
                </span>
                <div className="home-community-feed__copy">
                  <p>
                    <PublicCookAttribution author={recipe.author} /> published{" "}
                    {recipe.parent_version_id ? "a new version" : "an original recipe"}.
                  </p>
                  <Link className="home-community-feed__recipe" href={`/recipes/${recipe.id}`}>
                    {recipe.title}
                  </Link>
                </div>
                {publicationDate ? (
                  <time dateTime={recipe.published_at}>{publicationDate}</time>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function HowRecipeLabWorks() {
  return (
    <section
      className="home-principles home-how-it-works home-dashboard__workflow"
      id="how-it-works"
      aria-labelledby="how-it-works-heading"
    >
      <div className="section-heading home-dashboard__section-heading">
        <h2 id="how-it-works-heading">How Recipe Lab works</h2>
      </div>
      <ol className="principle-grid home-steps">
        <li className="home-steps__item">
          <span className="home-steps__number" aria-hidden="true">
            01
          </span>
          <h3>Choose a recipe</h3>
          <p>Search the collection and open the one that sounds good.</p>
        </li>
        <li className="home-steps__item">
          <span className="home-steps__number" aria-hidden="true">
            02
          </span>
          <h3>Your version</h3>
          <p>Change ingredients, amounts, or instructions without replacing the starting recipe.</p>
        </li>
        <li className="home-steps__item">
          <span className="home-steps__number" aria-hidden="true">
            03
          </span>
          <h3>See what changed</h3>
          <p>Compare your version with the recipe where you started.</p>
        </li>
      </ol>
    </section>
  );
}

export async function HomePublicDiscovery() {
  const [featuredResult, categoriesResult, communityResult] = await Promise.allSettled([
    fetchFeaturedRecipes(),
    fetchRecipeCategories(),
    fetchRecipePage({ page: 1, pageSize: COMMUNITY_FEED_SIZE, sort: "newest" }),
  ]);

  return (
    <div className="home-public-discovery">
      <FeaturedRecipes data={publicResult(featuredResult)} />
      <RecipeCategories data={publicResult(categoriesResult)} />
      <CommunityFeed data={publicResult(communityResult)} />
    </div>
  );
}
