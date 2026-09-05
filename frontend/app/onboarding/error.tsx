"use client";

export default function OnboardingError({ retry }: { retry: () => void }) {
  return (
    <main
      id="main-content"
      className="auth-page account-access-page account-access-page--onboarding"
    >
      <div
        className="auth-card auth-state account-access-card account-access-state account-access-state--error"
        role="alert"
      >
        <strong>We couldn’t open account setup.</strong>
        <p>Your recipe browsing is unaffected. Try opening this step again.</p>
        <button className="button button--secondary" type="button" onClick={retry}>
          Try again
        </button>
      </div>
    </main>
  );
}
