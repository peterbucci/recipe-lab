import { PageLoadingSkeleton } from "../../../shared/ui/page-loading-skeleton";

export default function MyRecipesLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell account-workspace-page account-recipes-page member-library"
      label="Loading your recipes…"
      title="My recipes"
      variant="member"
    />
  );
}
