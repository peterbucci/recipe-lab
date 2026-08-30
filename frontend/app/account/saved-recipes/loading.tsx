export default function SavedRecipesLoading() {
  return (
    <main
      id="main-content"
      className="state-page account-workspace-page account-saved-recipes-page member-library"
    >
      <div className="loading-state" role="status" aria-live="polite">
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading your saved recipes…</strong>
        <span>Opening your private saved collection.</span>
      </div>
    </main>
  );
}
