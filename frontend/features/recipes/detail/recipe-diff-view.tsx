import type { RecipeComparisonModel } from "./recipe-comparison-model";
import {
  RecipeComparisonHero,
  RecipeComparisonNavigation,
} from "./recipe-comparison-hero";
import { RecipeComparisonIngredients } from "./recipe-comparison-ingredients";
import { RecipeComparisonInstructions } from "./recipe-comparison-instructions";
import { RecipeComparisonNotes } from "./recipe-comparison-notes";

interface RecipeDiffViewProps {
  comparison: RecipeComparisonModel;
}

export function RecipeDiffView({ comparison }: RecipeDiffViewProps) {
  const pageHeadingId = `recipe-diff-heading-${comparison.recipe.id}`;

  return (
    <article className="recipe-diff-view" aria-labelledby={pageHeadingId}>
      <RecipeComparisonHero
        comparison={comparison}
        headingId={pageHeadingId}
      />
      <RecipeComparisonNavigation comparison={comparison} />

      <div className="recipe-diff-content">
        <aside
          className="recipe-comparison-legend"
          aria-label="Comparison legend"
        >
          <strong>Reading the comparison:</strong>
          <span className="recipe-comparison-legend__item">
            <span
              className="recipe-comparison-legend__marker recipe-comparison-legend__marker--added"
              aria-hidden="true"
            >
              +
            </span>
            Added / current
          </span>
          <span className="recipe-comparison-legend__item">
            <span
              className="recipe-comparison-legend__marker recipe-comparison-legend__marker--removed"
              aria-hidden="true"
            >
              −
            </span>
            Removed / previous
          </span>
          <span className="recipe-comparison-legend__item">
            <span
              className="recipe-comparison-legend__marker recipe-comparison-legend__marker--changed"
              aria-hidden="true"
            >
              ±
            </span>
            Changed
          </span>
        </aside>

        <section
          id="changes"
          className="recipe-comparison-content"
          aria-label="Recipe comparison"
        >
          <div className="recipe-comparison-body">
            <RecipeComparisonIngredients comparison={comparison} />
            <RecipeComparisonInstructions comparison={comparison} />
          </div>
          <div className="recipe-comparison-notes-area">
            <RecipeComparisonNotes comparison={comparison} />
          </div>
        </section>
      </div>
    </article>
  );
}
