import { PageLoadingSkeleton } from "../../shell/page-loading-skeleton";

export default function RecipeBrowseLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell page-shell--catalog catalog-dashboard catalog-dashboard--loading"
      label="Loading recipes…"
      variant="catalog"
    />
  );
}
