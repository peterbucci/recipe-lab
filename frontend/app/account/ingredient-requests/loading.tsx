import { PageLoadingSkeleton } from "../../components/loading-ui";

export default function MyIngredientRequestsLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell account-workspace-page account-ingredient-requests-page member-request-page"
      label="Loading ingredient requests…"
      title="Ingredient Requests"
      variant="member"
    />
  );
}
