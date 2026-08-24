export default function IngredientRequestReviewLoading() {
  return (
    <main id="main-content" className="state-page">
      <div className="loading-state" role="status" aria-live="polite">
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading review workspace…</strong>
        <span>Checking catalog-curator access.</span>
      </div>
    </main>
  );
}
