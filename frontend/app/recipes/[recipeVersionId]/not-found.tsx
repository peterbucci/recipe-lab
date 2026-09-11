import Link from "next/link";

import { StatePage, StatePanel } from "../../../shared/ui/state-page";

export default function RecipeNotFound() {
  return (
    <StatePage className="public-context-state">
      <StatePanel
        actions={
          <Link className="button button--primary" href="/recipes">
            Browse recipes
          </Link>
        }
        className="empty-state empty-state--large"
        description="Browse the public collection to find another recipe."
        eyebrow="Recipe unavailable"
        headingId="recipe-not-found-title"
        title="This recipe isn’t available."
      />
    </StatePage>
  );
}
