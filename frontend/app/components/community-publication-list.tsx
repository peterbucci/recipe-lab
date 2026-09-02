import Link from "next/link";

import type { RecipeSummary } from "../../lib/recipe-api";
import { PublicCookAttribution } from "./public-cook-attribution";

const relativeTimeFormatter = new Intl.RelativeTimeFormat("en", {
  numeric: "always",
});

function publicationTime(value: string): {
  absoluteLabel: string;
  relativeLabel: string;
} | null {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return null;

  const absoluteLabel = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date);
  const secondsFromNow = (date.valueOf() - Date.now()) / 1_000;
  const absoluteSeconds = Math.abs(secondsFromNow);
  if (absoluteSeconds < 60) {
    return {
      absoluteLabel,
      relativeLabel: secondsFromNow <= 0 ? "just now" : "in less than a minute",
    };
  }

  let unit: "minute" | "hour" | "day" | "month" | "year";
  let unitSeconds: number;
  if (absoluteSeconds < 3_600) {
    unit = "minute";
    unitSeconds = 60;
  } else if (absoluteSeconds < 86_400) {
    unit = "hour";
    unitSeconds = 3_600;
  } else if (absoluteSeconds < 2_629_800) {
    unit = "day";
    unitSeconds = 86_400;
  } else if (absoluteSeconds < 31_557_600) {
    unit = "month";
    unitSeconds = 2_629_800;
  } else {
    unit = "year";
    unitSeconds = 31_557_600;
  }

  return {
    absoluteLabel,
    relativeLabel: relativeTimeFormatter.format(
      Math.round(secondsFromNow / unitSeconds),
      unit,
    ),
  };
}

export function CommunityPublicationList({
  items,
}: {
  items: readonly RecipeSummary[];
}) {
  return (
    <ol className="home-community-feed__list">
      {items.map((recipe) => {
        const published = publicationTime(recipe.published_at);
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
