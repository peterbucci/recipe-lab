import Link from "next/link";

export default function RecipeNotFound() {
  return (
    <main id="main-content" className="state-page">
      <div className="empty-state empty-state--large">
        <span className="empty-state__mark" aria-hidden="true">
          ?
        </span>
        <p className="eyebrow">Recipe not found</p>
        <h1>This recipe version isn’t in the catalog.</h1>
        <p>It may have moved, or the link may be incomplete.</p>
        <Link className="button button--primary" href="/recipes">
          Browse recipes
        </Link>
      </div>
    </main>
  );
}
