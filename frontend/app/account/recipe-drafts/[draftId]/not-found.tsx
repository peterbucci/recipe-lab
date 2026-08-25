import Link from "next/link";

export default function RecipeDraftNotFound() {
  return (
    <main id="main-content" className="state-page">
      <section className="empty-state empty-state--large">
        <p className="eyebrow">Private draft unavailable</p>
        <h1>We couldn’t open that draft.</h1>
        <p>It may have been discarded, or it may belong to another account.</p>
        <Link className="button button--primary" href="/account/recipe-drafts">
          My recipe drafts
        </Link>
      </section>
    </main>
  );
}
