import Link from "next/link";

import {
  formatIngredientMeasure,
  formatRecipeDifficulty,
  formatRecipeDuration,
  formatServings,
} from "../../lib/format";
import type { RecipeCardSummary, RecipeDetail } from "../../lib/recipe-api";
import type { RecipeDraftEditorEntry } from "../../lib/recipe-draft-editor-entry";
import { relativeTimeLabel } from "../../lib/relative-time";
import { CookFollowControl } from "./cook-follow-control";
import { PublicCookAttribution } from "./public-cook-attribution";
import { RecipeArtwork } from "./recipe-artwork";
import { RecipeCategoryList } from "./recipe-category-list";
import { RecipeDetailTabs } from "./recipe-detail-tabs";
import { RecipeFamilyNavigator } from "./recipe-family-navigator";
import { RecipeInstructionsPanel } from "./recipe-instructions-panel";
import { RecipeMemberActions } from "./recipe-member-actions";
import { RecipeReportAccess } from "./recipe-report-access";

interface RecipeDetailViewProps {
  familyVersions?: RecipeCardSummary[];
  onActiveDraftChange?: (hasActiveDraft: boolean) => void;
  onEditableVersionReady?: (
    entry: RecipeDraftEditorEntry,
  ) => void | Promise<void>;
  recipe: RecipeDetail;
}

function authorInitial(displayName: string): string {
  return displayName.trim().charAt(0).toLocaleUpperCase() || "C";
}

export function RecipeDetailView({
  familyVersions = [],
  onActiveDraftChange,
  onEditableVersionReady,
  recipe,
}: RecipeDetailViewProps) {
  const isVariation = recipe.parent_version_id !== null;
  const publication = relativeTimeLabel(
    recipe.published_at ?? recipe.created_at,
  );

  return (
    <article className="recipe-detail">
      <header className="recipe-detail__header">
        <div className="recipe-detail__hero">
          <RecipeArtwork
            className="recipe-detail__artwork"
            recipeKey={recipe.id}
          />
          <div className="recipe-detail__intro">
            <div className="recipe-detail__label-row">
              <div className="recipe-detail__publication-meta">
                <p className="eyebrow recipe-detail__version-badge">
                  {isVariation ? "Version" : "Original"}
                </p>
                {publication ? (
                  <time
                    className="recipe-detail__published"
                    dateTime={recipe.published_at ?? recipe.created_at}
                    title={publication.absoluteLabel}
                  >
                    Published {publication.relativeLabel}
                  </time>
                ) : null}
              </div>
              <RecipeReportAccess recipeVersionId={recipe.id} />
            </div>
            <h1>{recipe.title}</h1>
            {recipe.parent ? (
              <p className="recipe-detail__parent-context">
                Based on{" "}
                <Link href={`/recipes/${recipe.parent.id}`}>
                  {recipe.parent.title}
                </Link>
                {" by "}
                <PublicCookAttribution author={recipe.parent.author} />
              </p>
            ) : isVariation ? (
              <p className="recipe-detail__parent-context">
                Source unavailable
              </p>
            ) : null}
            {recipe.description ? (
              <p className="recipe-detail__description">{recipe.description}</p>
            ) : null}
            <RecipeCategoryList
              categories={recipe.categories}
              label={`Categories for ${recipe.title}`}
            />
            <div className="recipe-detail__author-row">
              <div className="recipe-detail__author-identity">
                <span
                  className="recipe-detail__author-avatar"
                  aria-hidden="true"
                >
                  {authorInitial(recipe.author.display_name)}
                </span>
                <div className="recipe-detail__attribution">
                  <span>Recipe by</span>
                  <strong>
                    <PublicCookAttribution author={recipe.author} />
                  </strong>
                </div>
              </div>
              {recipe.author.handle ? (
                <CookFollowControl
                  cookId={recipe.author.id}
                  displayName={recipe.author.display_name}
                  handle={recipe.author.handle}
                  initialFollowerCount={0}
                  returnTo={`/recipes/${encodeURIComponent(recipe.id)}`}
                  showCount={false}
                  variant="inline"
                />
              ) : null}
            </div>
            <div
              className="recipe-facts recipe-detail__facts"
              aria-label="Recipe facts"
            >
              <dl>
                <div>
                  <dt>Total time</dt>
                  <dd>{formatRecipeDuration(recipe.total_time_minutes)}</dd>
                </div>
                <div>
                  <dt>Active time</dt>
                  <dd>{formatRecipeDuration(recipe.active_time_minutes)}</dd>
                </div>
                <div>
                  <dt>Makes</dt>
                  <dd>{formatServings(recipe.servings)}</dd>
                </div>
                <div>
                  <dt>Difficulty</dt>
                  <dd>{formatRecipeDifficulty(recipe.difficulty)}</dd>
                </div>
              </dl>
            </div>
            <div className="recipe-detail__member-actions">
              <RecipeMemberActions
                averageRating={recipe.average_rating}
                key={`${recipe.id}:${recipe.save_count}`}
                comparison={recipe.parent}
                onActiveDraftChange={onActiveDraftChange}
                ratingCount={recipe.rating_count}
                recipeVersionId={recipe.id}
                saveCount={recipe.save_count}
                showComparisonAction={false}
                onEditableVersionReady={onEditableVersionReady}
              />
            </div>
          </div>
        </div>
      </header>

      <RecipeDetailTabs
        recipe={
          <div className="recipe-detail__body">
            <section
              id="ingredients"
              className="ingredient-panel"
              aria-labelledby="ingredients-heading"
            >
              <div className="section-heading section-heading--compact">
                <div>
                  <h2 id="ingredients-heading">Ingredients</h2>
                </div>
                <span>{recipe.ingredients.length} items</span>
              </div>
              <ul className="ingredient-list">
                {recipe.ingredients.map((ingredient) => (
                  <li key={ingredient.id}>
                    <label>
                      <input
                        type="checkbox"
                        aria-label={`Mark ${ingredient.display_name} as gathered`}
                      />
                      <span className="ingredient-list__amount">
                        {formatIngredientMeasure(ingredient.measure)}
                      </span>
                      <span className="ingredient-list__name">
                        <strong>{ingredient.display_name}</strong>
                        {ingredient.preparation_notes ? (
                          <small>{ingredient.preparation_notes}</small>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </section>

            <RecipeInstructionsPanel
              ingredients={recipe.ingredients}
              instructions={recipe.instructions}
            />
          </div>
        }
        notes={
          <section
            id="recipe-notes"
            className="recipe-detail__notes"
            aria-labelledby="recipe-notes-heading"
          >
            <div className="section-heading section-heading--compact">
              <div>
                <h2 id="recipe-notes-heading">
                  Notes from {recipe.author.display_name}
                </h2>
              </div>
            </div>
            {recipe.notes ? (
              <p className="recipe-detail__notes-copy">{recipe.notes}</p>
            ) : (
              <p className="recipe-detail__notes-empty">
                No notes were added for this recipe.
              </p>
            )}
          </section>
        }
        family={
          <RecipeFamilyNavigator recipe={recipe} versions={familyVersions} />
        }
      />
    </article>
  );
}
