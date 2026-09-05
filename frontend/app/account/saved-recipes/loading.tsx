import { PageLoadingSkeleton } from "../../../shell/page-loading-skeleton";

export default function SavedRecipesLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell account-workspace-page account-saved-recipes-page member-library"
      label="Loading your saved recipes…"
      title="My recipes"
      variant="member"
    />
  );
}
