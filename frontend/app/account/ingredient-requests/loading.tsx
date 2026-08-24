export default function MyIngredientRequestsLoading() {
  return (
    <main id="main-content" className="state-page">
      <div className="loading-state" role="status" aria-live="polite">
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading your ingredient requests…</strong>
        <span>Checking your account and request history.</span>
      </div>
    </main>
  );
}
