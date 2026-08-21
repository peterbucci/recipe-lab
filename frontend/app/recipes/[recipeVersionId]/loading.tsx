export default function RecipeDetailLoading() {
  return (
    <main id="main-content" className="page-shell page-shell--detail">
      <div className="loading-state loading-state--detail" role="status" aria-live="polite">
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading recipe…</strong>
        <span>Preparing ingredients, instructions, and lineage.</span>
      </div>
      <div className="detail-skeleton" aria-hidden="true">
        <div />
        <div />
      </div>
    </main>
  );
}
