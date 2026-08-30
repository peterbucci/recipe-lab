export default function RecipeCompareLoading() {
  return (
    <main
      id="main-content"
      className="page-shell page-shell--detail recipe-comparison-page recipe-comparison-page--loading"
    >
      <div
        className="loading-state loading-state--detail loading-state--public"
        role="status"
        aria-live="polite"
      >
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading comparison…</strong>
        <span>Checking what changed in the ingredients and cooking steps.</span>
      </div>
      <div className="detail-skeleton" aria-hidden="true">
        <div />
        <div />
      </div>
    </main>
  );
}
