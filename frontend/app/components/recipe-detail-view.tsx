import Link from "next/link";

import { formatIngredientAmount, formatServings } from "../../lib/format";
import type { RecipeDetail, RecipeVersionReference } from "../../lib/recipe-api";
import { RatingSummary } from "./rating-summary";
import { RecipeInteractionPanel } from "./recipe-interaction-panel";

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
  const isVariant = recipe.parent_version_id !== null;

  return (
    <article className="recipe-detail">
      <header className="recipe-detail__header">
        <div>
          <p className="eyebrow">{isVariant ? `Variant · Version ${recipe.version_number}` : "Original recipe"}</p>
          <h1>{recipe.title}</h1>
          {recipe.description ? <p className="recipe-detail__description">{recipe.description}</p> : null}
        </div>
        <div className="recipe-facts" aria-label="Recipe facts">
          <dl>
            <div>
              <dt>Yield</dt>
              <dd>{formatServings(recipe.servings)}</dd>
            </div>
            <div>
              <dt>Version</dt>
              <dd>{recipe.version_number}</dd>
            </div>
          </dl>
          <RatingSummary average={recipe.average_rating} count={recipe.rating_count} />
        </div>
        <div className="button-row recipe-detail__actions">
          <Link
            className="button button--primary"
            href={`/recipes/${encodeURIComponent(recipe.id)}/fork`}
          >
            Create a variant
          </Link>
        </div>
        <RecipeInteractionPanel key={recipe.id} initialViewerState={recipe.viewer_state} />
      </header>

      <div className="recipe-detail__body">
        <section className="ingredient-panel" aria-labelledby="ingredients-heading">
          <div className="section-heading section-heading--compact">
            <div>
              <p className="eyebrow">Mise en place</p>
              <h2 id="ingredients-heading">Ingredients</h2>
            </div>
            <span>{recipe.ingredients.length} items</span>
          </div>
          <ul className="ingredient-list">
            {recipe.ingredients.map((ingredient) => {
              const authoredAlias =
                ingredient.display_name.trim().toLowerCase() !==
                ingredient.canonical_name.trim().toLowerCase();
              return (
                <li key={ingredient.id}>
                  <span className="ingredient-list__amount">
                    {formatIngredientAmount(ingredient.quantity, ingredient.unit)}
                  </span>
                  <span className="ingredient-list__name">
                    <strong>{ingredient.display_name}</strong>
                    {ingredient.preparation_notes ? <small>{ingredient.preparation_notes}</small> : null}
                    {authoredAlias ? <small>Catalog name: {ingredient.canonical_name}</small> : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="instruction-panel" aria-labelledby="instructions-heading">
          <div className="section-heading section-heading--compact">
            <div>
              <p className="eyebrow">Method</p>
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
            <p className="eyebrow">Immediate lineage</p>
            <h2 id="lineage-heading">How this version connects</h2>
          </div>
          <p>Parent and child links show one generation at a time.</p>
        </div>
        <ul className="lineage-grid" aria-label="Immediate recipe lineage">
          {recipe.parent ? (
            <li className="lineage-grid__item">
              <VersionLink label="Parent" version={recipe.parent} />
            </li>
          ) : null}
          <li className="lineage-grid__item">
            <div
              className="lineage-card lineage-card--current"
              aria-current="page"
              aria-label="Current recipe version"
            >
              <span>Current</span>
              <strong>{recipe.title}</strong>
              <small>Version {recipe.version_number}</small>
            </div>
          </li>
          {recipe.children.map((child) => (
            <li key={child.id} className="lineage-grid__item">
              <VersionLink label="Direct child" version={child} />
            </li>
          ))}
        </ul>
        {!recipe.parent && recipe.children.length === 0 ? (
          <p className="lineage-empty">This original recipe does not have a direct variant yet.</p>
        ) : null}
      </section>
    </article>
  );
}
