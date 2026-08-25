import Link from "next/link";
import type { ReactNode } from "react";

import { formatIngredientMeasure, formatServings } from "../../lib/format";
import type {
  RecipeDiff,
  RecipeFieldChange,
  RecipeIngredient,
  RecipeIngredientPairChange,
  RecipeInstruction,
  RecipeInstructionPairChange,
} from "../../lib/recipe-api";

interface RecipeDiffViewProps {
  diff: RecipeDiff;
}

interface ValuePairProps {
  before: ReactNode;
  after: ReactNode;
  beforeLabel?: string;
  afterLabel?: string;
}

const metadataLabels: Record<RecipeFieldChange["field"], string> = {
  title: "Title",
  description: "Description",
  servings: "Yield",
};

function ValuePair({
  before,
  after,
  beforeLabel = "Before",
  afterLabel = "After",
}: ValuePairProps) {
  return (
    <dl className="recipe-diff-values">
      <div className="recipe-diff-value recipe-diff-value--before">
        <dt>{beforeLabel}</dt>
        <dd>
          <del>{before}</del>
        </dd>
      </div>
      <div className="recipe-diff-value recipe-diff-value--after">
        <dt>{afterLabel}</dt>
        <dd>
          <ins>{after}</ins>
        </dd>
      </div>
    </dl>
  );
}

function IngredientValue({
  ingredient,
  showName = true,
}: {
  ingredient: RecipeIngredient;
  showName?: boolean;
}) {
  const authoredAlias =
    ingredient.display_name.trim().toLowerCase() !==
    ingredient.canonical_name.trim().toLowerCase();

  return (
    <span className="recipe-diff-ingredient">
      {showName ? <strong>{ingredient.display_name}</strong> : null}
      <span>{formatIngredientMeasure(ingredient.measure)}</span>
      {ingredient.preparation_notes ? (
        <small>Preparation: {ingredient.preparation_notes}</small>
      ) : null}
      {authoredAlias ? <small>Catalog name: {ingredient.canonical_name}</small> : null}
    </span>
  );
}

function SingleIngredientChange({
  ingredient,
  kind,
}: {
  ingredient: RecipeIngredient;
  kind: "added" | "removed";
}) {
  const added = kind === "added";
  const headingId = `ingredient-change-${kind}-${ingredient.id}`;
  return (
    <li className={`recipe-diff-entry recipe-diff-entry--${kind}`}>
      <article aria-labelledby={headingId}>
        <p className="recipe-diff-kind">{added ? "Added" : "Removed"}</p>
        <h3 id={headingId}>
          {added ? <ins>{ingredient.display_name}</ins> : <del>{ingredient.display_name}</del>}
        </h3>
        <div className={`recipe-diff-single-value recipe-diff-single-value--${kind}`}>
          <span>{added ? "New ingredient" : "Removed ingredient"}</span>
          {added ? (
            <ins>
              <IngredientValue ingredient={ingredient} showName={false} />
            </ins>
          ) : (
            <del>
              <IngredientValue ingredient={ingredient} showName={false} />
            </del>
          )}
        </div>
      </article>
    </li>
  );
}

function ingredientChangeLabels(change: RecipeIngredientPairChange): string[] {
  const labels: string[] = [];
  const fields = new Set(change.changed_fields);

  if (fields.has("measure")) {
    labels.push("Amount changed");
  }
  if (fields.has("display_name")) {
    labels.push("Name changed");
  }
  if (fields.has("preparation_notes")) {
    labels.push("Preparation changed");
  }

  return labels;
}

function PairedIngredientChange({
  change,
  kind,
}: {
  change: RecipeIngredientPairChange;
  kind: "substitution" | "modified";
}) {
  const substitution = kind === "substitution";
  const labels = ingredientChangeLabels(change);
  const secondaryLabels = substitution
    ? labels.filter((label) => label !== "Name changed")
    : labels.slice(1);
  const headingId = `ingredient-change-${kind}-${change.before.id}-${change.after.id}`;

  return (
    <li
      className={`recipe-diff-entry recipe-diff-entry--${
        substitution ? "substitution" : "modified"
      }`}
    >
      <article aria-labelledby={headingId}>
        <div className="recipe-diff-kinds" role="group" aria-label="Change type">
          <span className="recipe-diff-kind">
            {substitution ? "Substitution" : labels[0] ?? "Ingredient changed"}
          </span>
          {secondaryLabels.map((label) => (
            <span key={label} className="recipe-diff-kind recipe-diff-kind--secondary">
              {label}
            </span>
          ))}
        </div>
        <h3 id={headingId}>
          {substitution
            ? `${change.before.display_name} replaced with ${change.after.display_name}`
            : change.after.display_name}
        </h3>
        <ValuePair
          before={<IngredientValue ingredient={change.before} />}
          after={<IngredientValue ingredient={change.after} />}
          beforeLabel={substitution ? "Original ingredient" : "Before"}
          afterLabel={substitution ? "Replacement ingredient" : "After"}
        />
      </article>
    </li>
  );
}

function metadataValue(change: RecipeFieldChange, value: string | null): string {
  if (value === null || value.trim() === "") {
    return "Not provided";
  }
  return change.field === "servings" ? formatServings(value) : value;
}

function MetadataChange({ change }: { change: RecipeFieldChange }) {
  const label = metadataLabels[change.field];
  const headingId = `recipe-detail-change-${change.field}`;
  return (
    <li className="recipe-diff-entry recipe-diff-entry--modified">
      <article aria-labelledby={headingId}>
        <p className="recipe-diff-kind">{label} changed</p>
        <h3 id={headingId}>{label}</h3>
        <ValuePair
          before={metadataValue(change, change.before)}
          after={metadataValue(change, change.after)}
        />
      </article>
    </li>
  );
}

function SingleInstructionChange({
  instruction,
  kind,
}: {
  instruction: RecipeInstruction;
  kind: "added" | "removed";
}) {
  const added = kind === "added";
  const step = instruction.display_order + 1;
  const headingId = `instruction-change-${kind}-${instruction.id}`;
  return (
    <li className={`recipe-diff-entry recipe-diff-entry--${kind}`}>
      <article aria-labelledby={headingId}>
        <p className="recipe-diff-kind">Instruction {added ? "added" : "removed"}</p>
        <h3 id={headingId}>Step {step}</h3>
        <div className={`recipe-diff-single-value recipe-diff-single-value--${kind}`}>
          <span>{added ? "New instruction" : "Removed instruction"}</span>
          {added ? <ins>{instruction.text}</ins> : <del>{instruction.text}</del>}
        </div>
      </article>
    </li>
  );
}

function ModifiedInstruction({ change }: { change: RecipeInstructionPairChange }) {
  const headingId = `instruction-change-modified-${change.before.id}-${change.after.id}`;
  return (
    <li className="recipe-diff-entry recipe-diff-entry--modified">
      <article aria-labelledby={headingId}>
        <p className="recipe-diff-kind">Instruction changed</p>
        <h3 id={headingId}>Updated instruction</h3>
        <ValuePair before={change.before.text} after={change.after.text} />
      </article>
    </li>
  );
}

function ingredientChangeCount(diff: RecipeDiff): number {
  return (
    diff.ingredients.added.length +
    diff.ingredients.removed.length +
    diff.ingredients.replaced.length +
    diff.ingredients.modified.length
  );
}

function instructionChangeCount(diff: RecipeDiff): number {
  return (
    diff.instructions.added.length +
    diff.instructions.removed.length +
    diff.instructions.modified.length
  );
}

export function RecipeDiffView({ diff }: RecipeDiffViewProps) {
  const ingredientChanges = ingredientChangeCount(diff);
  const instructionChanges = instructionChangeCount(diff);
  const detailChanges = diff.metadata_changes.length;
  const totalChanges = ingredientChanges + instructionChanges + detailChanges;
  const pageHeadingId = `recipe-diff-heading-${diff.target_version.id}`;

  return (
    <article className="recipe-diff-view" aria-labelledby={pageHeadingId}>
      <header className="recipe-diff-view__header">
        <p className="eyebrow">What changed</p>
        <h1 id={pageHeadingId}>What changed in {diff.target_version.title}</h1>
        <p className="recipe-diff-view__lede">
          See how this recipe differs from {diff.base_version.title}. This comparison covers recipe
          details, ingredients, and instructions.
        </p>
        <nav className="recipe-diff-versions" aria-label="Compared recipes">
          <ol>
            <li>
              <Link href={`/recipes/${encodeURIComponent(diff.base_version.id)}`}>
                <span>Starting recipe</span>
                <strong>{diff.base_version.title}</strong>
                <small>Version {diff.base_version.version_number}</small>
              </Link>
            </li>
            <li>
              <Link href={`/recipes/${encodeURIComponent(diff.target_version.id)}`}>
                <span>This version</span>
                <strong>{diff.target_version.title}</strong>
                <small>Version {diff.target_version.version_number}</small>
              </Link>
            </li>
          </ol>
        </nav>
      </header>

      {!diff.has_changes ? (
        <section className="recipe-diff-empty" aria-labelledby="recipe-diff-empty-heading">
          <p className="eyebrow">Comparison complete</p>
          <h2 id="recipe-diff-empty-heading">No changes from the starting recipe</h2>
          <p>
            This version matches {diff.base_version.title} for recipe details, ingredients,
            and instructions.
          </p>
        </section>
      ) : (
        <div className="recipe-diff-content">
          <p className="recipe-diff-summary">
            {totalChanges} {totalChanges === 1 ? "change" : "changes"} from{" "}
            {diff.base_version.title}.
          </p>
          <ul className="recipe-diff-highlights" aria-label="Change highlights">
            {ingredientChanges > 0 ? (
              <li>
                {ingredientChanges} ingredient {ingredientChanges === 1 ? "change" : "changes"}
              </li>
            ) : null}
            {instructionChanges > 0 ? (
              <li>
                {instructionChanges} instruction{" "}
                {instructionChanges === 1 ? "change" : "changes"}
              </li>
            ) : null}
            {detailChanges > 0 ? (
              <li>
                {detailChanges} other detail {detailChanges === 1 ? "change" : "changes"}
              </li>
            ) : null}
          </ul>

          {ingredientChanges > 0 ? (
            <section className="recipe-diff-group" aria-labelledby="ingredient-changes-heading">
              <div className="section-heading section-heading--compact">
                <div>
                  <p className="eyebrow">Ingredients</p>
                  <h2 id="ingredient-changes-heading">Ingredient changes</h2>
                </div>
              </div>
              <ul className="recipe-diff-list">
                {diff.ingredients.replaced.map((change) => (
                  <PairedIngredientChange
                    key={`${change.before.id}:${change.after.id}`}
                    change={change}
                    kind="substitution"
                  />
                ))}
                {diff.ingredients.modified.map((change) => (
                  <PairedIngredientChange
                    key={`${change.before.id}:${change.after.id}`}
                    change={change}
                    kind="modified"
                  />
                ))}
                {diff.ingredients.added.map((ingredient) => (
                  <SingleIngredientChange
                    key={ingredient.id}
                    ingredient={ingredient}
                    kind="added"
                  />
                ))}
                {diff.ingredients.removed.map((ingredient) => (
                  <SingleIngredientChange
                    key={ingredient.id}
                    ingredient={ingredient}
                    kind="removed"
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {instructionChanges > 0 ? (
            <section className="recipe-diff-group" aria-labelledby="instruction-changes-heading">
              <div className="section-heading section-heading--compact">
                <div>
                  <p className="eyebrow">Method</p>
                  <h2 id="instruction-changes-heading">Instruction changes</h2>
                </div>
              </div>
              <ul className="recipe-diff-list">
                {diff.instructions.modified.map((change) => (
                  <ModifiedInstruction
                    key={`${change.before.id}:${change.after.id}`}
                    change={change}
                  />
                ))}
                {diff.instructions.added.map((instruction) => (
                  <SingleInstructionChange
                    key={instruction.id}
                    instruction={instruction}
                    kind="added"
                  />
                ))}
                {diff.instructions.removed.map((instruction) => (
                  <SingleInstructionChange
                    key={instruction.id}
                    instruction={instruction}
                    kind="removed"
                  />
                ))}
              </ul>
            </section>
          ) : null}

          {detailChanges > 0 ? (
            <section
              className="recipe-diff-group recipe-diff-group--secondary"
              aria-labelledby="recipe-detail-changes-heading"
            >
              <div className="section-heading section-heading--compact">
                <div>
                  <p className="eyebrow">Recipe information</p>
                  <h2 id="recipe-detail-changes-heading">Other details</h2>
                </div>
                <span>
                  {detailChanges} {detailChanges === 1 ? "change" : "changes"}
                </span>
              </div>
              <ul className="recipe-diff-list">
                {diff.metadata_changes.map((change) => (
                  <MetadataChange key={change.field} change={change} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </article>
  );
}
