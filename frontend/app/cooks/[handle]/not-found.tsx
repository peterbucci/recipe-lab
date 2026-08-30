import Link from "next/link";

export default function CookProfileNotFound() {
  return (
    <main id="main-content" className="state-page public-context-state">
      <div className="empty-state empty-state--large">
        <p className="eyebrow">Cook not found</p>
        <h1>We couldn’t find that cook.</h1>
        <p>The handle may have changed, or the link may be incomplete.</p>
        <Link className="button button--primary" href="/recipes">
          Browse recipes
        </Link>
      </div>
    </main>
  );
}
