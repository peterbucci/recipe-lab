import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="state-page">
      <div className="empty-state empty-state--large">
        <p className="eyebrow">Page not found</p>
        <h1>We couldn’t find that page.</h1>
        <p>Browse the recipes to find something to cook.</p>
        <Link className="button button--primary" href="/recipes">
          Browse recipes
        </Link>
      </div>
    </main>
  );
}
