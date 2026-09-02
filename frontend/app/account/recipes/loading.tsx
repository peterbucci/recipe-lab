import { PageLoadingSkeleton } from "../../components/loading-ui";

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
