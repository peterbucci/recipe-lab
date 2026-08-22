import Link from "next/link";

import { RecipeArtwork } from "./components/recipe-artwork";

export default function HomePage() {
  return (
    <main id="main-content">
      <section className="home-hero" aria-labelledby="home-title">
        <div className="home-hero__copy">
          <p className="eyebrow">Cook. Change. Learn.</p>
          <h1 id="home-title">Cook a recipe. Make it yours. Keep what worked.</h1>
          <p className="lede">
            Start with a complete recipe, shape a variation around the way you cook, and keep a
            clear record of every ingredient and instruction you changed.
          </p>
          <div className="button-row">
            <Link className="button button--primary" href="/recipes">
              Explore recipes
            </Link>
            <Link className="button button--secondary" href="#how-it-works">
              See how it works
            </Link>
          </div>
        </div>

        <div className="home-hero__visual">
          <RecipeArtwork
            className="home-hero__artwork"
            lineageKey="recipe-lab-home-lineage"
          />
          <div className="lineage-preview home-concept" aria-label="How a recipe variation works">
            <div className="lineage-preview__card home-concept__version">
              <span>Original recipe</span>
              <strong>Cook the complete starting recipe</strong>
              <small>Ingredients and instructions stay intact</small>
            </div>
            <span
              className="lineage-preview__connector home-concept__connector"
              aria-hidden="true"
            >
              ↓
            </span>
            <div className="lineage-preview__card lineage-preview__card--accent home-concept__version home-concept__version--variation">
              <span>Variation</span>
              <strong>Save your changes as a new version</strong>
              <small>The original is always there to compare</small>
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
            <p className="eyebrow">Three simple steps</p>
            <h2 id="how-it-works-heading">A cooking notebook that remembers the details.</h2>
          </div>
          <p>
            Explore a complete recipe, cook it as written or adjust it, then see exactly how your
            version differs from the one that inspired it.
          </p>
        </div>
        <ol className="principle-grid home-steps">
          <li className="home-steps__item">
            <span className="home-steps__number" aria-hidden="true">
              01
            </span>
            <h3>Choose something good to cook</h3>
            <p>Search the catalog and open a complete recipe with clear quantities and steps.</p>
          </li>
          <li className="home-steps__item">
            <span className="home-steps__number" aria-hidden="true">
              02
            </span>
            <h3>Make a variation</h3>
            <p>
              Adjust ingredients or instructions without overwriting the recipe you started from.
            </p>
          </li>
          <li className="home-steps__item">
            <span className="home-steps__number" aria-hidden="true">
              03
            </span>
            <h3>Compare what changed</h3>
            <p>
              Review the two versions side by side and carry the useful changes into your next cook.
            </p>
          </li>
        </ol>
      </section>
    </main>
  );
}
