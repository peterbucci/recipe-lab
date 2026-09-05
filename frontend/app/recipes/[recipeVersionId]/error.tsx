"use client";

import Link from "next/link";

interface RecipeDetailErrorProps {
  error: Error & { digest?: string };
  retry: () => void;
}

export default function RecipeDetailError({ retry }: RecipeDetailErrorProps) {
  return (
    <main id="main-content" className="state-page public-context-state">
      <div className="error-state blocking-error-state" role="alert">
        <p className="eyebrow">Something went wrong</p>
        <h1>We couldn’t load this recipe.</h1>
        <p>This recipe may be temporarily unavailable. Try again or browse the recipe collection.</p>
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
