"use client";

import Link from "next/link";

export default function CookProfileError({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="state-page">
      <div className="error-state" role="alert">
        <p className="eyebrow">Profile unavailable</p>
        <h1>We couldn’t load this cook’s profile.</h1>
        <p>Public recipe profiles may be temporarily unavailable. Try again in a moment.</p>
        <div className="button-row">
          <button className="button button--primary" type="button" onClick={reset}>
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
