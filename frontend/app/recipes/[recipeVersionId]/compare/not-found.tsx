import Link from "next/link";

import { StatePage, StatePanel } from "../../../../shared/ui/state-page";

export default function RecipeCompareNotFound() {
  return (
    <StatePage>
      <StatePanel
        actions={
          <>
            <Link className="button button--primary" href="/recipes">
              Browse recipes
            </Link>
            <Link className="button button--secondary" href="/">
              Return home
            </Link>
          </>
        }
        className="state-panel--wide state-panel--large"
        description="Browse the recipe collection to find something else to cook, or return home."
        eyebrow="Comparison unavailable"
        headingId="recipe-comparison-not-found-title"
        title="This comparison isn’t available."
      />
    </StatePage>
  );
}
