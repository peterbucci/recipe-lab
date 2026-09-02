import Link from "next/link";

import type { RecipeSummary } from "../../lib/recipe-api";
import { communityPublicationTimeLabel } from "../../lib/relative-time";
import { PublicCookAttribution } from "./public-cook-attribution";

export function CommunityPublicationList({
  items,
}: {
  items: readonly RecipeSummary[];
}) {
  return (
    <ol className="home-community-feed__list">
      {items.map((recipe) => {
        const published = communityPublicationTimeLabel(recipe.published_at);
        return (
          <li key={recipe.id} className="home-community-feed__item">
            <span className="home-community-feed__avatar" aria-hidden="true">
              {recipe.author.display_name.trim().charAt(0).toUpperCase() || "R"}
            </span>
            <div className="home-community-feed__copy">
              <p className="home-community-feed__action">
                <PublicCookAttribution author={recipe.author} /> published{" "}
                {recipe.parent_version_id
                  ? "a new version"
                  : "an original recipe"}
                .
              </p>
              <Link
                className="home-community-feed__recipe"
                href={`/recipes/${recipe.id}`}
              >
                {recipe.title}
              </Link>
              {published ? (
                <time
                  dateTime={recipe.published_at}
                  title={published.absoluteLabel}
                >
                  {published.relativeLabel}
                </time>
              ) : null}
            </div>
            <Link
              className="button button--secondary home-community-feed__view"
              href={`/recipes/${recipe.id}`}
              aria-label={`View ${recipe.title}`}
            >
              View
            </Link>
          </li>
        );
      })}
    </ol>
  );
}
