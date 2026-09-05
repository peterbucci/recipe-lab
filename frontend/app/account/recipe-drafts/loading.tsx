import { PageLoadingSkeleton } from "../../../shell/page-loading-skeleton";

export default function RecipeDraftsLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell account-workspace-page account-recipes-page member-library"
      label="Loading your private drafts…"
      title="My recipes"
      variant="member"
    />
  );
}
