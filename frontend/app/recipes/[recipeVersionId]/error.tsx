"use client";

import Link from "next/link";

interface RecipeDetailErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RecipeDetailError({ reset }: RecipeDetailErrorProps) {
  return (
    <main id="main-content" className="state-page">
      <div className="error-state" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h1>We couldn’t load this recipe.</h1>
        <p>This recipe may be temporarily unavailable. Try again or browse the recipe collection.</p>
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
