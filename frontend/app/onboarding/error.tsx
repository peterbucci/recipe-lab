"use client";

export default function OnboardingError({ reset }: { reset: () => void }) {
  return (
    <main id="main-content" className="auth-page">
      <div className="auth-card auth-state" role="alert">
        <strong>We couldn’t open account setup.</strong>
        <p>Your recipe browsing is unaffected. Try opening this step again.</p>
        <button className="button button--secondary" type="button" onClick={reset}>
          Try again
        </button>
      </div>
    </main>
  );
}
