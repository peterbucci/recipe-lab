import Link from "next/link";

import {
  formatIngredientMeasure,
  formatRecipeDifficulty,
  formatRecipeDuration,
  formatServings,
} from "../shared/recipe-format";
import type { RecipeDetail } from "../shared/recipe-contracts";
import type { RecipeHistory } from "../shared/recipe-history";
import { currentRecipePath, exactRecipePath } from "../shared/recipe-paths";
import { relativeTimeLabel } from "../../../shared/time/relative-time";
import { CookFollowControl } from "../../community/cook-follow-control";
import { PublicCookAttribution } from "../../community/public-cook-attribution";
import { RecipeArtwork } from "../shared/recipe-artwork";
import { RecipeCategoryList } from "../shared/recipe-category-list";
import { RecipeDetailTabs } from "../shared/recipe-detail-tabs";
import { RecipeFamilyNavigator } from "../shared/recipe-family-navigator";
import { RecipeIngredientGatherCheckbox } from "../shared/recipe-ingredient-gather-checkbox";
import { RecipeInstructionsPanel } from "./recipe-instructions-panel";
import {
  RecipeMemberActions,
  type RecipeEditActionState,
  type RecipeEditIntent,
} from "./recipe-member-actions";
import { RecipeReportAccess } from "../../moderation/reporting/recipe-report-access";

interface RecipeDetailViewProps {
  editAction: RecipeEditActionState;
  history?: RecipeHistory | null;
  onEditActionFocusRestored?: () => void;
  onRequestEdit: (intent: RecipeEditIntent) => void;
  publicPath: string;
  recipe: RecipeDetail;
  restoreEditActionFocus?: boolean;
}

function authorInitial(displayName: string): string {
  return displayName.trim().charAt(0).toLocaleUpperCase() || "C";
}

export function RecipeDetailView({
  editAction,
  history = null,
  onEditActionFocusRestored,
  onRequestEdit,
  publicPath,
  recipe,
  restoreEditActionFocus = false,
}: RecipeDetailViewProps) {
  const firstEdition = history?.editions.find(
    (edition) =>
      edition.recipe_id === recipe.recipe_id && edition.edition_number === 1,
  );
  const isAdaptation =
    recipe.relation_kind === "adaptation" ||
    recipe.adaptation_source !== null ||
    firstEdition?.relation_kind === "adaptation";
  const adaptationSource = recipe.adaptation_source ?? recipe.parent;
  const publication = relativeTimeLabel(
    recipe.published_at ?? recipe.created_at,
  );

  return (
    <article className="recipe-detail">
      {!recipe.is_current ? (
        <aside
          className="recipe-detail__version-notice"
          aria-label="Recipe version notice"
        >
          <p>You’re viewing an older published version of this recipe.</p>
          {recipe.current_version ? (
            <Link href={currentRecipePath(recipe.recipe_id)}>
              View the current version
            </Link>
          ) : null}
        </aside>
      ) : null}
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
                  {isAdaptation
                    ? `Adaptation · Published version ${recipe.edition_number}`
                    : recipe.edition_number > 1
                      ? `Published version ${recipe.edition_number}`
                      : "Original"}
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
            {adaptationSource ? (
              <p className="recipe-detail__parent-context">
                Based on{" "}
                <Link href={exactRecipePath(adaptationSource.id)}>
                  {adaptationSource.title}
                </Link>
                {" by "}
                <PublicCookAttribution author={adaptationSource.author} />
              </p>
            ) : isAdaptation ? (
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
                  returnTo={publicPath}
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
                editAction={editAction}
                onEditActionFocusRestored={onEditActionFocusRestored}
                onRequestEdit={onRequestEdit}
                publicPath={publicPath}
                ratingCount={recipe.rating_count}
                recipeVersionId={recipe.id}
                saveCount={recipe.save_count}
                restoreEditActionFocus={restoreEditActionFocus}
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
                      <RecipeIngredientGatherCheckbox
                        displayName={ingredient.display_name}
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
          <RecipeFamilyNavigator
            currentPath={publicPath}
            history={history}
            recipe={recipe}
          />
        }
      />
    </article>
  );
}
