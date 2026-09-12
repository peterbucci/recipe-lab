import type { RecipeCardSummary } from "../shared/recipe-contracts";
import { RecipeDetailTabs } from "../shared/recipe-detail-tabs";
import { RecipeFamilyNavigator } from "../shared/recipe-family-navigator";
import type { RecipeComparisonModel } from "./recipe-comparison-model";
import { RecipeComparisonHero } from "./recipe-comparison-hero";
import { RecipeComparisonIngredients } from "./recipe-comparison-ingredients";
import { RecipeComparisonInstructions } from "./recipe-comparison-instructions";
import { RecipeComparisonNotes } from "./recipe-comparison-notes";

interface RecipeDiffViewProps {
  comparison: RecipeComparisonModel;
  familyVersions?: readonly RecipeCardSummary[];
}

function RecipeComparisonLegend() {
  return (
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
  );
}

export function RecipeDiffView({
  comparison,
  familyVersions = [],
}: RecipeDiffViewProps) {
  const pageHeadingId = `recipe-diff-heading-${comparison.recipe.id}`;

  return (
    <article className="recipe-diff-view" aria-labelledby={pageHeadingId}>
      <RecipeComparisonHero
        comparison={comparison}
        headingId={pageHeadingId}
      />
      <RecipeDetailTabs
        className="recipe-comparison-tabs"
        recipe={
          <div className="recipe-diff-content">
            <RecipeComparisonLegend />
            <section
              className="recipe-comparison-content"
              aria-label="Recipe comparison"
            >
              <div className="recipe-comparison-body">
                <RecipeComparisonIngredients comparison={comparison} />
                <RecipeComparisonInstructions comparison={comparison} />
              </div>
            </section>
          </div>
        }
        notes={
          <div className="recipe-diff-content recipe-diff-content--notes">
            <RecipeComparisonNotes comparison={comparison} />
          </div>
        }
        family={
          <RecipeFamilyNavigator
            currentRecipeIsPage={false}
            recipe={comparison.recipe}
            versions={familyVersions}
          />
        }
      />
    </article>
  );
}
