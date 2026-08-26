import Link from "next/link";

export default function RecipeNotFound() {
  return (
    <main id="main-content" className="state-page">
      <div className="empty-state empty-state--large">
        <p className="eyebrow">Recipe unavailable</p>
        <h1>This recipe isn’t available.</h1>
        <p>Browse the public collection to find another recipe.</p>
        <Link className="button button--primary" href="/recipes">
          Browse recipes
        </Link>
      </div>
    </main>
  );
}
