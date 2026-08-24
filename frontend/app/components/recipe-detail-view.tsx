import Link from "next/link";

import {
  catalogNameForDisplay,
  formatIngredientAmount,
  formatServings,
} from "../../lib/format";
import type { RecipeDetail, RecipeVersionReference } from "../../lib/recipe-api";
import { RatingSummary } from "./rating-summary";
import { RecipeArtwork } from "./recipe-artwork";
import { RecipeMemberActions } from "./recipe-member-actions";

interface RecipeDetailViewProps {
  recipe: RecipeDetail;
}

function VersionLink({ label, version }: { label: string; version: RecipeVersionReference }) {
  return (
    <Link className="lineage-card" href={`/recipes/${version.id}`}>
      <span>{label}</span>
      <strong>{version.title}</strong>
      <small>Version {version.version_number}</small>
    </Link>
  );
}

export function RecipeDetailView({ recipe }: RecipeDetailViewProps) {
  const isVariation = recipe.parent_version_id !== null;

  return (
    <article className="recipe-detail">
      <header className="recipe-detail__header">
        <div className="recipe-detail__hero">
          <RecipeArtwork className="recipe-detail__artwork" lineageKey={recipe.lineage_id} />
          <div className="recipe-detail__intro">
            <p className="eyebrow">{isVariation ? "Variation" : "Original"}</p>
            <h1>{recipe.title}</h1>
            {recipe.description ? (
              <p className="recipe-detail__description">{recipe.description}</p>
            ) : null}
            <div className="recipe-facts recipe-detail__facts" aria-label="Recipe facts">
              <dl>
                <div>
                  <dt>Makes</dt>
                  <dd>{formatServings(recipe.servings)}</dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{recipe.version_number}</dd>
                </div>
              </dl>
              <RatingSummary average={recipe.average_rating} count={recipe.rating_count} />
            </div>
            <RecipeMemberActions
              key={recipe.id}
              comparison={recipe.parent}
              recipeVersionId={recipe.id}
            />
          </div>
        </div>
      </header>

      <div className="recipe-detail__body">
        <section className="ingredient-panel" aria-labelledby="ingredients-heading">
          <div className="section-heading section-heading--compact">
            <div>
              <h2 id="ingredients-heading">Ingredients</h2>
            </div>
            <span>{recipe.ingredients.length} items</span>
          </div>
          <ul className="ingredient-list">
            {recipe.ingredients.map((ingredient) => {
              const catalogName = catalogNameForDisplay(
                ingredient.display_name,
                ingredient.canonical_name,
              );
              return (
                <li key={ingredient.id}>
                  <span className="ingredient-list__amount">
                    {formatIngredientAmount(ingredient.quantity, ingredient.unit)}
                  </span>
                  <span className="ingredient-list__name">
                    <strong>{ingredient.display_name}</strong>
                    {ingredient.preparation_notes ? <small>{ingredient.preparation_notes}</small> : null}
                    {catalogName ? <small>Catalog name: {catalogName}</small> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="instruction-panel" aria-labelledby="instructions-heading">
          <div className="section-heading section-heading--compact">
            <div>
              <h2 id="instructions-heading">Instructions</h2>
            </div>
            <span>{recipe.instructions.length} steps</span>
          </div>
          <ol className="instruction-list">
            {recipe.instructions.map((instruction) => (
              <li key={instruction.id}>{instruction.text}</li>
            ))}
          </ol>
        </section>
      </div>

      <section className="lineage-section" aria-labelledby="lineage-heading">
        <div className="section-heading">
          <div>
            <h2 id="lineage-heading">More versions of this recipe</h2>
          </div>
          <p>
            See the recipe this one is based on and other versions made directly from it.
          </p>
        </div>
        <ul className="lineage-grid" aria-label="More versions of this recipe">
          {recipe.parent ? (
            <li className="lineage-grid__item">
              <VersionLink label="Based on" version={recipe.parent} />
            </li>
          ) : null}
          <li className="lineage-grid__item">
            <div
              className="lineage-card lineage-card--current"
              aria-current="page"
              aria-label="Current recipe version"
            >
              <span>This version</span>
              <strong>{recipe.title}</strong>
              <small>Version {recipe.version_number}</small>
            </div>
          </li>
          {recipe.children.map((child) => (
            <li key={child.id} className="lineage-grid__item">
              <VersionLink label="Another version" version={child} />
            </li>
          ))}
        </ul>
        {!recipe.parent && recipe.children.length === 0 ? (
          <p className="lineage-empty">This recipe does not have another version yet.</p>
        ) : null}
      </section>
    </article>
  );
}
