export default function RecipeDraftEditorLoading() {
  return (
    <main
      id="main-content"
      className="state-page recipe-authoring-state recipe-authoring-state--loading"
    >
      <p className="recipe-authoring-state__panel" role="status">
        Loading your private recipe draft…
      </p>
    </main>
  );
}
