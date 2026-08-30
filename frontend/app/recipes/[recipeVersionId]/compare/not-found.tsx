import Link from "next/link";

export default function RecipeCompareNotFound() {
  return (
    <main id="main-content" className="state-page public-context-state">
      <div className="empty-state empty-state--large">
        <p className="eyebrow">Comparison unavailable</p>
        <h1>This comparison isn’t available.</h1>
        <p>
          Browse the recipe collection to find something else to cook, or return
          home.
        </p>
        <div className="button-row">
          <Link className="button button--primary" href="/recipes">
            Browse recipes
          </Link>
          <Link className="button button--secondary" href="/">
            Return home
          </Link>
        </div>
      </div>
    </main>
  );
}
