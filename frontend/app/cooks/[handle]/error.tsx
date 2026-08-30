"use client";

import Link from "next/link";

export default function CookProfileError({ retry }: { retry: () => void }) {
  return (
    <main id="main-content" className="state-page public-context-state">
      <div className="error-state" role="alert">
        <p className="eyebrow">Profile unavailable</p>
        <h1>We couldn’t load this cook’s profile.</h1>
        <p>Public recipe profiles may be temporarily unavailable. Try again in a moment.</p>
        <div className="button-row">
          <button className="button button--primary" type="button" onClick={retry}>
            Try again
          </button>
          <Link className="button button--secondary" href="/recipes">
            Browse recipes
          </Link>
        </div>
      </div>
    </main>
  );
}
