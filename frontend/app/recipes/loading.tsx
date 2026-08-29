export default function RecipeBrowseLoading() {
  return (
    <main
      id="main-content"
      className="page-shell catalog-dashboard catalog-dashboard--loading"
    >
      <header className="page-intro catalog-dashboard__intro">
        <div className="catalog-dashboard__intro-copy">
          <h1>Find something to cook</h1>
          <p>Search by name or description, then open the recipe that sounds good.</p>
        </div>
        <div
          className="catalog-toolbar catalog-dashboard__search-panel catalog-dashboard__search-panel--loading"
          aria-hidden="true"
        >
          <div className="skeleton-search" />
        </div>
      </header>

      <section
        className="catalog-results catalog-dashboard__results catalog-results--loading"
        aria-labelledby="catalog-loading-heading"
      >
        <div className="section-heading section-heading--compact catalog-results__heading">
          <h2 id="catalog-loading-heading">Recipes</h2>
        </div>
        <div className="loading-state" role="status" aria-live="polite">
          <span className="loading-state__pulse" aria-hidden="true" />
          <strong>Loading recipes…</strong>
          <span>Loading the recipe list.</span>
        </div>
        <div className="skeleton-grid catalog-results__grid" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => (
            <div className="skeleton-card" key={index} />
          ))}
        </div>
      </section>
    </main>
  );
}
