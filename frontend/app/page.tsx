import Link from "next/link";

import { RecipeArtwork } from "./components/recipe-artwork";

export default function HomePage() {
  return (
    <main id="main-content">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <h1 id="home-title">Recipes change. Recipe Lab keeps track.</h1>
          <p className="lede">
            Start with a recipe, change it to suit you, and save your version without changing the
            recipe you started from. Compare the two to see exactly what changed.
          </p>
          <div className="button-row">
            <Link className="button button--primary" href="/recipes">
              Explore recipes
            </Link>
            <Link className="button button--secondary" href="#how-it-works">
              How it works
            </Link>
          </div>
        </div>

        <div className="home-hero__visual">
          <RecipeArtwork
            className="home-hero__artwork"
            lineageKey="recipe-lab-home-lineage"
          />
          <div
            className="lineage-preview home-concept"
            aria-label="How saving a changed recipe works"
          >
            <div className="lineage-preview__card home-concept__version">
              <span>Starting recipe</span>
              <strong>Start with a recipe</strong>
              <small>The recipe stays unchanged</small>
            </div>
            <span
              className="lineage-preview__connector home-concept__connector"
              aria-hidden="true"
            >
              ↓
            </span>
            <div className="lineage-preview__card lineage-preview__card--accent home-concept__version home-concept__version--variation">
              <span>Your version</span>
              <strong>Save it as your own version</strong>
              <small>Compare it with the recipe you started from</small>
            </div>
          </div>
        </div>
      </section>

      <section
        className="home-principles home-how-it-works"
        id="how-it-works"
        aria-labelledby="how-it-works-heading"
      >
        <div className="section-heading">
          <div>
            <h2 id="how-it-works-heading">How Recipe Lab works</h2>
          </div>
          <p>
            Every recipe can be a starting point. Change what you want, save your version, and keep
            it connected to the recipe you started with.
          </p>
        </div>
        <ol className="principle-grid home-steps">
          <li className="home-steps__item">
            <span className="home-steps__number" aria-hidden="true">
              01
            </span>
            <h3>Find a recipe</h3>
            <p>Browse recipes and versions already in Recipe Lab.</p>
          </li>
          <li className="home-steps__item">
            <span className="home-steps__number" aria-hidden="true">
              02
            </span>
            <h3>Make it yours</h3>
            <p>Change ingredients, amounts, or instructions.</p>
          </li>
          <li className="home-steps__item">
            <span className="home-steps__number" aria-hidden="true">
              03
            </span>
            <h3>Compare versions</h3>
            <p>See exactly what differs from the recipe you started with.</p>
          </li>
        </ol>
      </section>
    </main>
  );
}
