export default function RecipeDetailLoading() {
  return (
    <main
      id="main-content"
      className="page-shell page-shell--detail recipe-reading-page recipe-reading-page--loading"
    >
      <div
        className="loading-state loading-state--detail loading-state--public"
        role="status"
        aria-live="polite"
      >
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading recipe…</strong>
        <span>Loading ingredients and instructions.</span>
      </div>
      <div className="detail-skeleton" aria-hidden="true">
        <div />
        <div />
      </div>
    </main>
  );
}
