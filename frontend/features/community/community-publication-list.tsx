import Link from "next/link";

import type { RecipeSummary } from "../recipes/shared/recipe-contracts";
import { communityPublicationTimeLabel } from "../../shared/time/relative-time";
import { PublicCookAttribution } from "./public-cook-attribution";

export function CommunityPublicationList({
  items,
  recipeHref,
}: {
  items: readonly RecipeSummary[];
  recipeHref: (recipe: RecipeSummary) => string;
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
                {recipe.relation_kind === "original"
                  ? "an original recipe"
                  : recipe.relation_kind === "adaptation"
                    ? "a new adaptation"
                    : `changes as published version ${recipe.edition_number}`}
                .
              </p>
              <Link
                className="home-community-feed__recipe"
                href={recipeHref(recipe)}
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
              href={recipeHref(recipe)}
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
