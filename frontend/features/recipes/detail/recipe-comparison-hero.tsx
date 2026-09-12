import Link from "next/link";

import { PublicCookAttribution } from "../../community/public-cook-attribution";
import { relativeTimeLabel } from "../../../shared/time/relative-time";
import { RecipeArtwork } from "../shared/recipe-artwork";
import { RecipeCategoryList } from "../shared/recipe-category-list";
import type {
  RecipeDifficulty,
  RecipeFieldChange,
  RecipeFieldValue,
} from "../shared/recipe-contracts";
import {
  formatRecipeDifficulty,
  formatRecipeDuration,
  formatServings,
} from "../shared/recipe-format";
import type { RecipeComparisonModel } from "./recipe-comparison-model";

function authorInitial(displayName: string): string {
  return displayName.trim().charAt(0).toLocaleUpperCase() || "C";
}

function textValue(value: RecipeFieldValue): string {
  if (value === null || (typeof value === "string" && value.trim() === "")) {
    return "Not provided";
  }
  return String(value);
}

function priorFieldValue(change: RecipeFieldChange): string {
  if (change.field === "servings") {
    return change.before === null
      ? "Not provided"
      : formatServings(String(change.before));
  }
  if (
    change.field === "total_time_minutes" ||
    change.field === "active_time_minutes"
  ) {
    const minutes =
      typeof change.before === "number"
        ? change.before
        : Number(change.before);
    return formatRecipeDuration(Number.isFinite(minutes) ? minutes : null);
  }
  if (change.field === "difficulty") {
    const difficulty: RecipeDifficulty | null =
      change.before === "easy" ||
      change.before === "medium" ||
      change.before === "hard"
        ? change.before
        : null;
    return formatRecipeDifficulty(difficulty);
  }
  return textValue(change.before);
}

function PriorValue({
  change,
  label = "Was",
}: {
  change: RecipeFieldChange | undefined;
  label?: string;
}) {
  if (!change) return null;

  return (
    <small className="recipe-comparison-previous">
      <strong>{label}</strong>
      <del>{priorFieldValue(change)}</del>
    </small>
  );
}

function RecipeFact({
  change,
  label,
  value,
}: {
  change: RecipeFieldChange | undefined;
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>
        <span>{value}</span>
        <PriorValue change={change} />
      </dd>
    </div>
  );
}

function changeLabel(totalChanges: number): string {
  return `${totalChanges} ${totalChanges === 1 ? "change" : "changes"}`;
}

export function RecipeComparisonHero({
  comparison,
  headingId,
}: {
  comparison: RecipeComparisonModel;
  headingId: string;
}) {
  const { diff, metadataChanges, recipe, totalChanges } = comparison;
  const isVariation = recipe.parent_version_id !== null;
  const publicationValue = recipe.published_at ?? recipe.created_at;
  const publication = relativeTimeLabel(publicationValue);

  return (
    <header className="recipe-comparison-hero">
      <RecipeArtwork
        className="recipe-comparison-hero__artwork"
        recipeKey={recipe.id}
      />
      <div className="recipe-comparison-hero__intro">
        <div className="recipe-comparison-hero__label-row">
          <span className="recipe-comparison-hero__version">
            {isVariation ? `Version ${recipe.version_number}` : "Original"}
          </span>
          {publication ? (
            <time
              className="recipe-comparison-hero__published"
              dateTime={publicationValue}
              title={publication.absoluteLabel}
            >
              Published {publication.relativeLabel}
            </time>
          ) : null}
          <span className="recipe-comparison-hero__mode">
            Comparison view
          </span>
        </div>

        <h1 id={headingId}>{recipe.title}</h1>
        <PriorValue change={metadataChanges.title} label="Previous title" />

        {recipe.parent ? (
          <p className="recipe-comparison-hero__parent-context">
            Based on{" "}
            <Link href={`/recipes/${encodeURIComponent(recipe.parent.id)}`}>
              {recipe.parent.title}
            </Link>
            {" by "}
            <PublicCookAttribution author={recipe.parent.author} />
          </p>
        ) : isVariation ? (
          <p className="recipe-comparison-hero__parent-context">
            Source unavailable
          </p>
        ) : null}

        {recipe.description ? (
          <p className="recipe-comparison-hero__description">
            {recipe.description}
          </p>
        ) : metadataChanges.description ? (
          <p className="recipe-comparison-hero__description">
            No description was added.
          </p>
        ) : null}
        <PriorValue change={metadataChanges.description} />

        <RecipeCategoryList
          categories={recipe.categories}
          label={`Categories for ${recipe.title}`}
        />

        <div className="recipe-comparison-hero__author">
          <span
            className="recipe-comparison-hero__author-avatar"
            aria-hidden="true"
          >
            {authorInitial(recipe.author.display_name)}
          </span>
          <p>
            <span>Recipe by</span>
            <strong>
              <PublicCookAttribution author={recipe.author} />
            </strong>
          </p>
        </div>

        <div className="recipe-comparison-hero__facts" aria-label="Recipe facts">
          <dl>
            <RecipeFact
              change={metadataChanges.total_time_minutes}
              label="Total time"
              value={formatRecipeDuration(recipe.total_time_minutes)}
            />
            <RecipeFact
              change={metadataChanges.active_time_minutes}
              label="Active time"
              value={formatRecipeDuration(recipe.active_time_minutes)}
            />
            <RecipeFact
              change={metadataChanges.servings}
              label="Makes"
              value={formatServings(recipe.servings)}
            />
            <RecipeFact
              change={metadataChanges.difficulty}
              label="Difficulty"
              value={formatRecipeDifficulty(recipe.difficulty)}
            />
          </dl>
        </div>

        <div className="recipe-comparison-strip">
          <span className="recipe-comparison-strip__icon" aria-hidden="true">
            ↔
          </span>
          <div>
            <p>Comparing against</p>
            <strong>
              {diff.base_version.title} · Version{" "}
              {diff.base_version.version_number}
            </strong>
          </div>
          <span className="recipe-comparison-strip__count">
            {changeLabel(totalChanges)}
          </span>
        </div>

        <div className="recipe-comparison-hero__actions">
          <Link
            className="button button--secondary"
            href={`/recipes/${encodeURIComponent(diff.base_version.id)}`}
          >
            View starting recipe
          </Link>
          <Link
            className="button button--primary"
            href={`/recipes/${encodeURIComponent(recipe.id)}`}
          >
            Back to {recipe.title}
          </Link>
        </div>
      </div>
    </header>
  );
}
