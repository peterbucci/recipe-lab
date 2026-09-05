import { PageLoadingSkeleton } from "../../../shell/page-loading-skeleton";

export default function IngredientRequestReviewLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell staff-workspace staff-workspace--curation curation-page"
      label="Loading ingredient request review…"
      title="Ingredient requests"
      variant="staff"
    />
  );
}
