import { PageLoadingSkeleton } from "../../../components/loading-ui";

export default function RecipeCompareLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell page-shell--detail recipe-comparison-page recipe-comparison-page--loading"
      label="Loading recipe comparison…"
      variant="comparison"
    />
  );
}
