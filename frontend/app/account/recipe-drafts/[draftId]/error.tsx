"use client";

import Link from "next/link";

interface RecipeDraftEditorErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RecipeDraftEditorError({ reset }: RecipeDraftEditorErrorProps) {
  return (
    <main id="main-content" className="state-page">
      <section className="error-state" role="alert">
        <p className="eyebrow">Private draft unavailable</p>
        <h1>We couldn’t prepare the draft editor.</h1>
        <p>The ingredient or cooking-action catalog may be temporarily unavailable.</p>
        <div className="button-row">
          <button className="button button--primary" type="button" onClick={reset}>
            Try again
          </button>
          <Link className="button button--secondary" href="/account/recipe-drafts">
            My recipe drafts
          </Link>
        </div>
      </section>
    </main>
  );
}
