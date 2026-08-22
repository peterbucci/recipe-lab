export default function RecipeBrowseLoading() {
  return (
    <main id="main-content" className="page-shell">
      <div className="loading-state" role="status" aria-live="polite">
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading recipes…</strong>
        <span>Setting the table for your next idea.</span>
      </div>
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton-card" key={index} />
        ))}
      </div>
    </main>
  );
}
