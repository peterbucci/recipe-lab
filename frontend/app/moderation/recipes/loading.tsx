import { PageLoadingSkeleton } from "../../../shell/page-loading-skeleton";

export default function RecipeModerationLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell staff-workspace staff-workspace--moderation moderation-workspace"
      label="Loading recipe moderation…"
      title="Recipe reports"
      variant="staff"
    />
  );
}
