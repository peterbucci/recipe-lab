export default function RecipeModerationLoading() {
  return (
    <main
      id="main-content"
      className="state-page staff-state-page staff-state-page--moderation staff-state-page--loading"
    >
      <div
        className="loading-state staff-state-panel"
        role="status"
        aria-live="polite"
      >
        <span className="loading-state__pulse" aria-hidden="true" />
        <strong>Loading moderation workspace…</strong>
        <span>Checking recipe-moderator access.</span>
      </div>
    </main>
  );
}
