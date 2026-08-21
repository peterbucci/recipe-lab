"use client";

import Link from "next/link";

interface RecipeErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RecipeError({ reset }: RecipeErrorProps) {
  return (
    <main id="main-content" className="state-page">
      <div className="error-state" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h1>We couldn’t load the recipes.</h1>
        <p>The catalog may be temporarily unavailable. Try again, or return to the home page.</p>
        <div className="button-row">
          <button className="button button--primary" type="button" onClick={reset}>
            Try again
          </button>
          <Link className="button button--secondary" href="/">
            Return home
          </Link>
        </div>
      </div>
    </main>
  );
}
