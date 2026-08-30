export default function MyRecipesLoading() {
  return (
    <main
      id="main-content"
      className="state-page account-workspace-page account-recipes-page member-library"
    >
      <div className="loading-state" role="status" aria-live="polite">
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading your recipes…</strong>
        <span>Checking your private drafts and published recipes.</span>
      </div>
    </main>
  );
}
