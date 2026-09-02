import Link from "next/link";

import {
  fetchFeaturedRecipes,
  fetchRecipeCategories,
  type FeaturedRecipeList,
  type RecipeCategoryList,
} from "../../lib/recipe-api";
import { HomePublicFailureReporter } from "./home-load-state";
import { RecipeCard } from "./recipe-card";

const FEATURED_RECIPE_LIMIT = 4;

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
          <h1
            className="home-content-section__title"
            id="home-featured-heading"
          >
            Featured recipes
          </h1>
        </div>
        <Link className="text-link" href="/recipes">
          View all <span aria-hidden="true">→</span>
        </Link>
      </header>

      {data === null ? (
        <div
          aria-label="Featured recipes unavailable"
          className="home-section-state home-section-state--unavailable"
        >
          <p>Unavailable</p>
        </div>
      ) : data.items.length === 0 ? (
        <div className="home-section-state">
          <p>No recipes are featured right now.</p>
          <Link href="/recipes">Browse the full recipe collection</Link>
        </div>
      ) : (
        <ul
          className="recipe-grid home-featured-recipes__grid"
          aria-label="Featured recipes"
        >
          {data.items.slice(0, FEATURED_RECIPE_LIMIT).map((recipe) => (
            <RecipeCard
              key={recipe.id}
              engagement={{
                averageRating: recipe.average_rating,
                ratingCount: recipe.rating_count,
                saveCount: recipe.save_count,
              }}
              recipe={recipe}
            />
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
          <h2
            className="home-content-section__title"
            id="home-categories-heading"
          >
            Explore by category
          </h2>
        </div>
      </header>

      {data === null ? (
        <div
          aria-label="Recipe categories unavailable"
          className="home-section-state home-section-state--unavailable"
        >
          <p>Unavailable</p>
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

export async function HomePublicDiscovery() {
  const [featuredResult, categoriesResult] = await Promise.allSettled([
    fetchFeaturedRecipes(),
    fetchRecipeCategories(),
  ]);
  const failed = [featuredResult, categoriesResult].some(
    (result) => result.status === "rejected",
  );

  return (
    <div className="home-public-discovery">
      <HomePublicFailureReporter failed={failed} />
      <FeaturedRecipes data={publicResult(featuredResult)} />
      <RecipeCategories data={publicResult(categoriesResult)} />
    </div>
  );
}
