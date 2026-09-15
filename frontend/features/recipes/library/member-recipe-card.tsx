import Link from "next/link";
import type { ReactNode } from "react";

import type { RecipeSummary } from "../shared/recipe-contracts";
import { formatMemberRecipeDate } from "./member-recipe-presentation";
import { PublicCookAttribution } from "../../community/public-cook-attribution";
import { RecipeArtwork } from "../shared/recipe-artwork";
import { RecipeCardShell } from "../shared/recipe-card-shell";
import {
  currentRecipePath,
  exactRecipePath,
  ordinaryRecipePath,
} from "../shared/recipe-paths";

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

function RecipeContext({
  recipe,
  state,
}: {
  recipe: RecipeSummary;
  state: MemberRecipeCardState;
}) {
  const adaptationSource = recipe.adaptation_source ?? recipe.parent;
  if (state === "saved") {
    return (
      <p className="member-recipe-card__context member-recipe-card__context--saved">
        <span className="member-recipe-card__author-mark" aria-hidden="true">
          {recipe.author.display_name.trim().slice(0, 1).toUpperCase() || "R"}
        </span>
        <span>
          {adaptationSource ? (
            <>
              Based on{" "}
              <Link href={exactRecipePath(adaptationSource.id)}>
                {adaptationSource.title}
              </Link>
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          By <PublicCookAttribution author={recipe.author} />
        </span>
      </p>
    );
  }

  if (adaptationSource) {
    return (
      <p className="member-recipe-card__context">
        Based on{" "}
        <Link href={exactRecipePath(adaptationSource.id)}>
          {adaptationSource.title}
        </Link>
        {" by "}
        <PublicCookAttribution author={adaptationSource.author} />
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
          <time dateTime={savedAt}>{formatMemberRecipeDate(savedAt)}</time>
        </span>
      ) : (
        <span>
          {state === "withdrawn" ? "Originally published" : "Published"}{" "}
          <time dateTime={recipe.published_at}>
            {formatMemberRecipeDate(recipe.published_at)}
          </time>
        </span>
      )}
      {state === "saved" ? (
        <span>
          Published{" "}
          <time dateTime={recipe.published_at}>
            {formatMemberRecipeDate(recipe.published_at)}
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
  const publicPath =
    state === "saved" ? exactRecipePath(recipe.id) : ordinaryRecipePath(recipe);
  const lineageLabel =
    recipe.relation_kind === "adaptation"
      ? "Adaptation"
      : recipe.edition_number > 1
        ? `Published version ${recipe.edition_number}`
        : "Original";
  const titleId = `member-recipe-card-${recipe.id}`;
  const artwork = (
    <RecipeArtwork
      className="member-recipe-card__artwork-graphic"
      recipeKey={recipe.id}
    />
  );

  return (
    <RecipeCardShell
      aria-labelledby={titleId}
      artwork={
        publiclyAccessible ? (
          <Link
            aria-label={`View ${recipe.title}`}
            className="member-recipe-card__artwork"
            href={publicPath}
          >
            {artwork}
          </Link>
        ) : (
          <div className="member-recipe-card__artwork">{artwork}</div>
        )
      }
      bodyClassName="member-recipe-card__body"
      className={`member-recipe-card member-recipe-card--${state}`}
      itemClassName="member-recipe-card__item"
    >
      <div className="member-recipe-card__topline">
        <span
          className={`member-recipe-card__status member-recipe-card__status--${state}`}
        >
          {lineageLabel}
        </span>
      </div>

      <h3 id={titleId}>
        {publiclyAccessible ? (
          <Link href={publicPath}>{recipe.title}</Link>
        ) : (
          recipe.title
        )}
      </h3>
      <RecipeContext recipe={recipe} state={state} />
      <CardDescription recipe={recipe} state={state} />
      <CardMetadata recipe={recipe} savedAt={savedAt} state={state} />
      {state === "saved" && !recipe.is_current ? (
        <p className="member-recipe-card__newer-version">
          {recipe.current_version ? (
            <Link href={currentRecipePath(recipe.recipe_id)}>
              Newer version available
            </Link>
          ) : (
            "Newer version available"
          )}
        </p>
      ) : null}

      <div className="member-recipe-card__actions">
        {publiclyAccessible ? (
          <Link
            className="button button--secondary member-recipe-card__view"
            href={publicPath}
          >
            View recipe
          </Link>
        ) : null}
        {actions}
      </div>
    </RecipeCardShell>
  );
}
