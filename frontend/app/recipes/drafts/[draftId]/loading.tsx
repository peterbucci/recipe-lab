import { PageLoadingSkeleton } from "../../../components/loading-ui";

export default function RecipeDraftWorkspaceLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell page-shell--detail recipe-reading-page draft-editor-page draft-editor-page--loading recipe-workspace-page"
      label="Loading your private recipe draft…"
      variant="authoring"
    />
  );
}
