import Link from "next/link";
import type { ReactNode } from "react";

import { formatServings } from "../shared/recipe-format";
import type {
  RecipeSummary,
} from "../shared/recipe-contracts";
import { PublicCookAttribution } from "../../community/public-cook-attribution";
import { RecipeArtwork } from "../shared/recipe-artwork";
import { RecipeCardShell } from "../shared/recipe-card-shell";
import { RecipeCardEngagement } from "./recipe-card-engagement";
import { RecipeCategoryList } from "../shared/recipe-category-list";
import { exactRecipePath, ordinaryRecipePath } from "../shared/recipe-paths";

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
  const adaptationSource = recipe.adaptation_source ?? recipe.parent;
  const recipeTitle = publiclyAccessible ? (
    <Link href={ordinaryRecipePath(recipe)}>{recipe.title}</Link>
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
      {adaptationSource ? (
        <p className="recipe-card__parent">
          Based on{" "}
          <Link href={exactRecipePath(adaptationSource.id)}>
            {adaptationSource.title}
          </Link>
          {" by "}
          <PublicCookAttribution author={adaptationSource.author} />
        </p>
      ) : recipe.parent_version_id ? (
        <p className="recipe-card__parent">Source unavailable</p>
      ) : null}
    </>
  );
  const engagementLineage = adaptationSource ? (
    <>
      Based on{" "}
      <Link href={exactRecipePath(adaptationSource.id)}>{adaptationSource.title}</Link>
    </>
  ) : recipe.parent_version_id || recipe.relation_kind === "adaptation" ? (
    "Based on unavailable source"
  ) : (
    recipe.relation_kind === "revision" ? "Published version" : "Original"
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
          returnTo={ordinaryRecipePath(recipe)}
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
