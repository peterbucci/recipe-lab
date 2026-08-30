"use client";

import Link from "next/link";

interface RecipeCompareErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function RecipeCompareError({ retry }: RecipeCompareErrorProps) {
  return (
    <main id="main-content" className="state-page public-context-state">
      <div className="error-state" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h1>We couldn’t load this comparison.</h1>
        <p>
          This comparison may be temporarily unavailable. Try again or browse
          recipes.
        </p>
        <div className="button-row">
          <button
            className="button button--primary"
            type="button"
            onClick={retry}
          >
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
