import Link from "next/link";
import type { ReactNode } from "react";

import { formatServings } from "../../lib/format";
import type { RecipeSummary } from "../../lib/recipe-api";
import { PublicCookAttribution } from "./public-cook-attribution";
import { RecipeArtwork } from "./recipe-artwork";
import { RecipeCardShell } from "./recipe-card-shell";
import { RecipeCardEngagement } from "./recipe-card-engagement";
import { RecipeCategoryList } from "./recipe-category-list";

export interface RecipeCardEngagementSummary {
  averageRating: number | null;
  ratingCount: number;
  saveCount: number;
}

interface RecipeCardProps {
  actions?: ReactNode;
  engagement?: RecipeCardEngagementSummary;
  publiclyAccessible?: boolean;
  recipe: RecipeSummary;
  showEngagementDescription?: boolean;
  visibilityLabel?: string;
}

export function RecipeCard({
  actions,
  engagement,
  publiclyAccessible = true,
  recipe,
  showEngagementDescription = false,
  visibilityLabel,
}: RecipeCardProps) {
  const titleId = `recipe-card-title-${recipe.id}`;
  const recipeTitle = publiclyAccessible ? (
    <Link href={`/recipes/${recipe.id}`}>{recipe.title}</Link>
  ) : (
    recipe.title
  );
  const cardContent = (
    <>
      <header className="recipe-card__header">
        <h3 id={titleId}>{recipeTitle}</h3>
        <p className="recipe-card__attribution">
          By <PublicCookAttribution author={recipe.author} />
        </p>
      </header>
      {recipe.description ? (
        <p className="recipe-card__description">{recipe.description}</p>
      ) : null}
      <RecipeCategoryList
        categories={recipe.categories}
        label={`Categories for ${recipe.title}`}
      />
      {recipe.parent ? (
        <p className="recipe-card__parent">
          Based on{" "}
          <Link href={`/recipes/${recipe.parent.id}`}>
            {recipe.parent.title}
          </Link>
          {" by "}
          <PublicCookAttribution author={recipe.parent.author} />
        </p>
      ) : recipe.parent_version_id ? (
        <p className="recipe-card__parent">Source unavailable</p>
      ) : null}
    </>
  );
  const engagementLineage = recipe.parent ? (
    <>
      Based on{" "}
      <Link href={`/recipes/${recipe.parent.id}`}>{recipe.parent.title}</Link>
    </>
  ) : recipe.parent_version_id ? (
    "Based on unavailable source"
  ) : (
    "Original"
  );

  return (
    <RecipeCardShell
      aria-labelledby={titleId}
      artwork={
        <RecipeArtwork className="recipe-card__artwork" recipeKey={recipe.id} />
      }
      bodyClassName="recipe-card__body"
      className={`recipe-card${engagement ? " recipe-card--engagement" : ""}`}
      itemClassName="recipe-grid__item"
    >
      {engagement ? (
        <RecipeCardEngagement
          averageRating={engagement.averageRating}
          lineageLabel={engagementLineage}
          ratingCount={engagement.ratingCount}
          recipeVersionId={recipe.id}
          saveCount={engagement.saveCount}
          servings={formatServings(recipe.servings)}
          title={recipe.title}
        >
          <header className="recipe-card__header">
            <h3 id={titleId}>{recipeTitle}</h3>
            <p className="recipe-card__attribution">
              <PublicCookAttribution author={recipe.author} />
            </p>
            {showEngagementDescription && recipe.description ? (
              <p className="recipe-card__description recipe-card__description--engagement">
                {recipe.description}
              </p>
            ) : null}
          </header>
        </RecipeCardEngagement>
      ) : (
        <>
          {cardContent}
          <footer className="recipe-card__footer">
            <div className="recipe-card__metadata">
              <p className="recipe-card__servings">
                {formatServings(recipe.servings)}
              </p>
              {visibilityLabel ? (
                <p className="recipe-card__status">{visibilityLabel}</p>
              ) : null}
            </div>
            {actions ? (
              <div className="recipe-card__actions">{actions}</div>
            ) : null}
          </footer>
        </>
      )}
      {engagement && actions ? (
        <div className="recipe-card__actions">{actions}</div>
      ) : null}
    </RecipeCardShell>
  );
}
