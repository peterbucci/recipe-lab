export default function OnboardingLoading() {
  return (
    <main id="main-content" className="auth-page">
      <div className="auth-card auth-state" role="status">
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Opening account setup…</strong>
      </div>
    </main>
  );
}
