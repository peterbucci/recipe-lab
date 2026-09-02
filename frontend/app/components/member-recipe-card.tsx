import Link from "next/link";
import type { ReactNode } from "react";

import type { RecipeSummary } from "../../lib/recipe-api";
import { PublicCookAttribution } from "./public-cook-attribution";
import { RecipeArtwork } from "./recipe-artwork";

export type MemberRecipeCardState =
  | "published"
  | "saved"
  | "withdrawn"
  | "moderation_hidden";

interface MemberRecipeCardProps {
  actions?: ReactNode;
  recipe: RecipeSummary;
  savedAt?: string;
  state: MemberRecipeCardState;
}

function formatCardDate(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(timestamp),
  );
}

function RecipeContext({
  recipe,
  state,
}: {
  recipe: RecipeSummary;
  state: MemberRecipeCardState;
}) {
  if (state === "saved") {
    return (
      <p className="member-recipe-card__context member-recipe-card__context--saved">
        <span className="member-recipe-card__author-mark" aria-hidden="true">
          {recipe.author.display_name.trim().slice(0, 1).toUpperCase() || "R"}
        </span>
        <span>
          {recipe.parent ? (
            <>
              Based on{" "}
              <Link href={`/recipes/${recipe.parent.id}`}>
                {recipe.parent.title}
              </Link>
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          By <PublicCookAttribution author={recipe.author} />
        </span>
      </p>
    );
  }

  if (recipe.parent) {
    return (
      <p className="member-recipe-card__context">
        Based on{" "}
        <Link href={`/recipes/${recipe.parent.id}`}>{recipe.parent.title}</Link>
        {" by "}
        <PublicCookAttribution author={recipe.parent.author} />
      </p>
    );
  }

  if (recipe.parent_version_id) {
    return <p className="member-recipe-card__context">Source unavailable</p>;
  }

  return null;
}

function CardDescription({
  recipe,
  state,
}: {
  recipe: RecipeSummary;
  state: MemberRecipeCardState;
}) {
  if (state === "withdrawn") {
    return (
      <p className="member-recipe-card__description member-recipe-card__description--withdrawn">
        This recipe is no longer visible publicly. Its recipe-family history is
        preserved.
      </p>
    );
  }

  if (state === "moderation_hidden") {
    return (
      <p className="member-recipe-card__description member-recipe-card__description--withdrawn">
        This recipe is hidden from public view by moderation. Its visibility
        cannot be changed here.
      </p>
    );
  }

  return recipe.description ? (
    <p className="member-recipe-card__description">{recipe.description}</p>
  ) : null;
}

function CardMetadata({
  recipe,
  savedAt,
  state,
}: {
  recipe: RecipeSummary;
  savedAt?: string;
  state: MemberRecipeCardState;
}) {
  return (
    <div className="member-recipe-card__metadata">
      {state === "saved" && savedAt ? (
        <span>
          Saved{" "}
          <time dateTime={savedAt}>{formatCardDate(savedAt)}</time>
        </span>
      ) : (
        <span>
          {state === "withdrawn" ? "Originally published" : "Published"}{" "}
          <time dateTime={recipe.published_at}>
            {formatCardDate(recipe.published_at)}
          </time>
        </span>
      )}
      {state === "saved" ? (
        <span>
          Published{" "}
          <time dateTime={recipe.published_at}>
            {formatCardDate(recipe.published_at)}
          </time>
        </span>
      ) : null}
    </div>
  );
}

export function MemberRecipeCard({
  actions,
  recipe,
  savedAt,
  state,
}: MemberRecipeCardProps) {
  const publiclyAccessible = state === "published" || state === "saved";
  const lineageLabel = recipe.parent_version_id ? "Version" : "Original";
  const titleId = `member-recipe-card-${recipe.id}`;
  const artwork = (
    <RecipeArtwork
      className="member-recipe-card__artwork-graphic"
      recipeKey={recipe.id}
    />
  );

  return (
    <li className="member-recipe-card__item">
      <article
        className={`member-recipe-card member-recipe-card--${state}`}
        aria-labelledby={titleId}
      >
        {publiclyAccessible ? (
          <Link
            aria-label={`View ${recipe.title}`}
            className="member-recipe-card__artwork"
            href={`/recipes/${recipe.id}`}
          >
            {artwork}
          </Link>
        ) : (
          <div className="member-recipe-card__artwork">{artwork}</div>
        )}

        <div className="member-recipe-card__body">
          <div className="member-recipe-card__topline">
            <span
              className={`member-recipe-card__status member-recipe-card__status--${state}`}
            >
              {lineageLabel}
            </span>
          </div>

          <h3 id={titleId}>
            {publiclyAccessible ? (
              <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>
            ) : (
              recipe.title
            )}
          </h3>
          <RecipeContext recipe={recipe} state={state} />
          <CardDescription recipe={recipe} state={state} />
          <CardMetadata recipe={recipe} savedAt={savedAt} state={state} />

          <div className="member-recipe-card__actions">
            {publiclyAccessible ? (
              <Link
                className="button button--secondary member-recipe-card__view"
                href={`/recipes/${recipe.id}`}
              >
                View recipe
              </Link>
            ) : null}
            {actions}
          </div>
        </div>
      </article>
    </li>
  );
}
