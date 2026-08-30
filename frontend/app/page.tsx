import Link from "next/link";
import { Suspense } from "react";

import { HomeDashboardLayout } from "./components/home-dashboard-layout";
import {
  HomePublicDiscovery,
  HowRecipeLabWorks,
} from "./components/home-public-discovery";
import { RecipeArtwork } from "./components/recipe-artwork";
import { RecipeSearch } from "./components/recipe-search";

export const dynamic = "force-dynamic";

export default function HomePage() {
  return (
    <main id="main-content" className="home-dashboard">
      <section
        className="home-hero home-dashboard__hero"
        aria-labelledby="home-title"
      >
        <div className="home-hero__copy home-dashboard__intro">
          <h1 id="home-title">Recipes change. Recipe Lab keeps track.</h1>
          <p className="lede">
            Find a recipe you want to cook, save a version with your changes, and compare it with
            where you started.
          </p>
          <div className="home-dashboard__search-panel">
            <RecipeSearch
              ariaLabel="Search recipes from the home page"
              idPrefix="home-recipe-search"
              query=""
            />
          </div>
          <div className="button-row">
            <Link className="button button--primary" href="/recipes">
              Explore recipes
            </Link>
          </div>
        </div>

        <div className="home-hero__visual home-dashboard__artwork-panel">
          <RecipeArtwork
            className="home-hero__artwork"
            lineageKey="recipe-lab-home-lineage"
          />
        </div>
      </section>

      <HomeDashboardLayout>
        <Suspense
          fallback={
            <div className="home-public-discovery home-public-discovery--loading" role="status">
              <p>Loading recipe discovery…</p>
            </div>
          }
        >
          <HomePublicDiscovery />
        </Suspense>
        <HowRecipeLabWorks />
      </HomeDashboardLayout>
    </main>
  );
}
