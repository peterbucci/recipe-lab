import Link from "next/link";

import { RecipeArtwork } from "./components/recipe-artwork";

export default function HomePage() {
  return (
    <main id="main-content">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <h1 id="home-title">Recipes change. Recipe Lab keeps track.</h1>
          <p className="lede">
            Find a recipe you want to cook, save a version with your changes, and compare it with
            where you started.
          </p>
          <div className="button-row">
            <Link className="button button--primary" href="/recipes">
              Explore recipes
            </Link>
          </div>
        </div>

        <div className="home-hero__visual">
          <RecipeArtwork
            className="home-hero__artwork"
            lineageKey="recipe-lab-home-lineage"
          />
        </div>
      </section>

      <section
        className="home-principles home-how-it-works"
        id="how-it-works"
        aria-labelledby="how-it-works-heading"
      >
        <div className="section-heading">
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
    </main>
  );
}
