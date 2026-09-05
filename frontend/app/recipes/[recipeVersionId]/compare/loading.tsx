import { PageLoadingSkeleton } from "../../../../shared/ui/page-loading-skeleton";

export default function RecipeCompareLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell page-shell--detail recipe-comparison-page recipe-comparison-page--loading"
      label="Loading recipe comparison…"
      variant="comparison"
    />
  );
}
