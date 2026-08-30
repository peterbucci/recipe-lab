export default function OnboardingLoading() {
  return (
    <main
      id="main-content"
      className="auth-page account-access-page account-access-page--onboarding"
    >
      <div
        className="auth-card auth-state account-access-card account-access-state account-access-state--loading"
        role="status"
      >
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Opening account setup…</strong>
      </div>
    </main>
  );
}
