export default function RecipeModerationLoading() {
  return (
    <main id="main-content" className="state-page">
      <div className="loading-state" role="status" aria-live="polite">
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading moderation workspace…</strong>
        <span>Checking recipe-moderator access.</span>
      </div>
    </main>
  );
}
