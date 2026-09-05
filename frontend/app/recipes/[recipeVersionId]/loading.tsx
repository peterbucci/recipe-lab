import { PageLoadingSkeleton } from "../../components/loading-ui";

export default function RecipeDetailLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell page-shell--detail recipe-reading-page recipe-reading-page--loading"
      label="Loading recipe…"
      variant="recipe"
    />
  );
}
