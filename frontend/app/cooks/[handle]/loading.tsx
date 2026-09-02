import { PageLoadingSkeleton } from "../../components/loading-ui";

export default function CookProfileLoading() {
  return (
    <PageLoadingSkeleton
      className="page-shell cook-profile public-cook-page public-cook-page--loading"
      label="Loading cook profile…"
      variant="cook"
    />
  );
}
