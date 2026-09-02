"use client";

import Link from "next/link";

interface RecipeDraftWorkspaceErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function RecipeDraftWorkspaceError({
  reset,
}: RecipeDraftWorkspaceErrorProps) {
  return (
    <main
      id="main-content"
      className="state-page recipe-authoring-state recipe-authoring-state--error"
    >
      <section
        className="error-state recipe-authoring-state__panel blocking-error-state"
        role="alert"
      >
        <p className="eyebrow">Something went wrong</p>
        <h1>We couldn’t prepare the draft editor.</h1>
        <p>The ingredient or cooking-action catalog may be temporarily unavailable.</p>
        <div className="button-row">
          <button
            className="button button--primary"
            type="button"
            onClick={reset}
          >
            Try again
          </button>
          <Link
            className="button button--secondary"
            href="/account/recipes?view=drafts"
          >
            My recipes
          </Link>
        </div>
      </section>
    </main>
  );
}
