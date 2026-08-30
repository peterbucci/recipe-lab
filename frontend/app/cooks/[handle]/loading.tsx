export default function CookProfileLoading() {
  return (
    <main
      id="main-content"
      className="page-shell cook-profile public-cook-page public-cook-page--loading"
    >
      <div className="loading-state loading-state--public" role="status" aria-live="polite">
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading cook profile…</strong>
        <span>Loading this cook’s public recipes.</span>
      </div>
      <div className="skeleton-grid" aria-hidden="true">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="skeleton-card" key={index} />
        ))}
      </div>
    </main>
  );
}
