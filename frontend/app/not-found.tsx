import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="state-page">
      <div className="empty-state empty-state--large">
        <p className="eyebrow">Page not found</p>
        <h1>There’s nothing cooking at this address.</h1>
        <p>Return to the catalog and find a recipe to explore.</p>
        <Link className="button button--primary" href="/recipes">
          Browse recipes
        </Link>
      </div>
    </main>
  );
}
