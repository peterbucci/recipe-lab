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
  beforeLabel = "Starting recipe",
  afterLabel = "This recipe",
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
  return (
    <span className="recipe-diff-ingredient">
      {showName ? <strong>{ingredient.display_name}</strong> : null}
      <span>{formatIngredientMeasure(ingredient.measure)}</span>
      {ingredient.preparation_notes ? (
        <small>Preparation: {ingredient.preparation_notes}</small>
      ) : null}
    </span>
  );
}

function ingredientWithMeasure(ingredient: RecipeIngredient): string {
  return `${formatIngredientMeasure(ingredient.measure)} ${ingredient.display_name}`;
}

function ingredientChangeHeading(change: RecipeIngredientPairChange): string {
  const fields = new Set(change.changed_fields);
  if (fields.has("measure")) {
    return `Change ${change.after.display_name} from ${formatIngredientMeasure(
      change.before.measure,
    )} to ${formatIngredientMeasure(change.after.measure)}`;
  }
  if (fields.has("display_name")) {
    return `Rename ${change.before.display_name} to ${change.after.display_name}`;
  }
  if (fields.has("preparation_notes")) {
    return `Change how ${change.after.display_name} is prepared`;
  }
  return `Change ${change.after.display_name}`;
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
          {added ? "Add " : "Remove "}
          {added ? (
            <ins>{ingredient.display_name}</ins>
          ) : (
            <del>{ingredient.display_name}</del>
          )}
        </h3>
        <div
          className={`recipe-diff-single-value recipe-diff-single-value--${kind}`}
        >
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
        <div
          className="recipe-diff-kinds"
          role="group"
          aria-label="Change type"
        >
          <span className="recipe-diff-kind">
            {substitution
              ? "Substitution"
              : (labels[0] ?? "Ingredient changed")}
          </span>
          {secondaryLabels.map((label) => (
            <span
              key={label}
              className="recipe-diff-kind recipe-diff-kind--secondary"
            >
              {label}
            </span>
          ))}
        </div>
        <h3 id={headingId}>
          {substitution ? (
            <>
              Use <ins>{change.after.display_name}</ins> instead of{" "}
              <del>{change.before.display_name}</del>
            </>
          ) : (
            ingredientChangeHeading(change)
          )}
        </h3>
        <ValuePair
          before={<IngredientValue ingredient={change.before} />}
          after={<IngredientValue ingredient={change.after} />}
          beforeLabel={substitution ? "Starting ingredient" : undefined}
          afterLabel={substitution ? "Use instead" : undefined}
        />
      </article>
    </li>
  );
}

function metadataValue(
  change: RecipeFieldChange,
  value: string | null,
): string {
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
  ingredients,
}: {
  instruction: RecipeInstruction;
  kind: "added" | "removed";
  ingredients: readonly RecipeIngredient[];
}) {
  const added = kind === "added";
  const step = instruction.display_order + 1;
  const headingId = `instruction-change-${kind}-${instruction.id}`;
  return (
    <li className={`recipe-diff-entry recipe-diff-entry--${kind}`}>
      <article aria-labelledby={headingId}>
        <p className="recipe-diff-kind">
          Cooking step {added ? "added" : "removed"}
        </p>
        <h3 id={headingId}>
          {added ? "Add" : "Remove"} step {step}
        </h3>
        <div
          className={`recipe-diff-single-value recipe-diff-single-value--${kind}`}
        >
          <span>{added ? "New cooking step" : "Removed cooking step"}</span>
          {added ? (
            <ins>
              <InstructionValue
                instruction={instruction}
                ingredients={ingredients}
                actionLabel="Cooking actions in the added step"
              />
            </ins>
          ) : (
            <del>
              <InstructionValue
                instruction={instruction}
                ingredients={ingredients}
                actionLabel="Cooking actions in the removed step"
              />
            </del>
          )}
        </div>
      </article>
    </li>
  );
}

function InstructionValue({
  instruction,
  ingredients,
  actionLabel,
}: {
  instruction: RecipeInstruction;
  ingredients: readonly RecipeIngredient[];
  actionLabel: string;
}) {
  return (
    <div className="recipe-diff-instruction">
      <span>{instruction.text}</span>
      <ComparisonInstructionActions
        actions={instruction.actions}
        ingredients={ingredients}
        label={actionLabel}
      />
    </div>
  );
}

function ComparisonInstructionActions({
  actions,
  ingredients,
  label,
}: {
  actions: readonly RecipeInstruction["actions"][number][];
  ingredients: readonly RecipeIngredient[];
  label: string;
}) {
  if (actions.length === 0) {
    return null;
  }

  const ingredientById = new Map(
    ingredients.map((ingredient) => [ingredient.id, ingredient]),
  );
  return (
    <ol className="instruction-actions" aria-label={label}>
      {[...actions]
        .sort((left, right) => left.display_order - right.display_order)
        .map((action) => {
          const inputLabels = action.ingredient_occurrence_ids.map(
            (id) =>
              ingredientById.get(id)?.display_name ??
              "Ingredient not available",
          );
          return (
            <li key={action.id}>
              <strong>{action.action_type.canonical_verb}</strong>
              {!action.action_type.active ? (
                <span>Previously used action</span>
              ) : null}
              {inputLabels.length > 0 ? (
                <small>With {inputLabels.join(", ")}</small>
              ) : null}
              {action.duration ? (
                <small>For {action.duration.display}</small>
              ) : null}
              {action.temperature ? (
                <small>At {action.temperature.display}</small>
              ) : null}
            </li>
          );
        })}
    </ol>
  );
}

function instructionChangeLabels(
  change: RecipeInstructionPairChange,
): string[] {
  const labels = new Map<
    RecipeInstructionPairChange["changed_fields"][number],
    string
  >([
    ["text", "Wording changed"],
    ["actions", "Cooking actions changed"],
    ["inputs", "Ingredients used in the step changed"],
    ["action_order", "Order within the step changed"],
    ["duration", "Timing changed"],
    ["temperature", "Temperature changed"],
  ]);
  return change.changed_fields.map(
    (field) => labels.get(field) ?? "Instruction changed",
  );
}

function ModifiedInstruction({
  change,
  beforeIngredients,
  afterIngredients,
}: {
  change: RecipeInstructionPairChange;
  beforeIngredients: readonly RecipeIngredient[];
  afterIngredients: readonly RecipeIngredient[];
}) {
  const headingId = `instruction-change-modified-${change.before.id}-${change.after.id}`;
  const labels = instructionChangeLabels(change);
  return (
    <li className="recipe-diff-entry recipe-diff-entry--modified">
      <article aria-labelledby={headingId}>
        <div
          className="recipe-diff-kinds"
          role="group"
          aria-label="Change type"
        >
          {labels.map((label, index) => (
            <span
              key={label}
              className={`recipe-diff-kind${index > 0 ? " recipe-diff-kind--secondary" : ""}`}
            >
              {label}
            </span>
          ))}
        </div>
        <h3 id={headingId}>Update step {change.after.display_order + 1}</h3>
        <ValuePair
          before={
            <InstructionValue
              instruction={change.before}
              ingredients={beforeIngredients}
              actionLabel="Cooking actions in the starting recipe"
            />
          }
          after={
            <InstructionValue
              instruction={change.after}
              ingredients={afterIngredients}
              actionLabel="Cooking actions in this recipe"
            />
          }
        />
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

function instructionChangeSummary(change: RecipeInstructionPairChange): string {
  const step = change.after.display_order + 1;
  const fields = new Set(change.changed_fields);
  if (fields.has("text")) {
    return `Update step ${step}: ${change.after.text}`;
  }
  if (fields.has("inputs")) {
    return `Change the ingredients used in step ${step}.`;
  }
  if (fields.has("action_order")) {
    return `Change the order of cooking actions in step ${step}.`;
  }
  if (fields.has("actions")) {
    return `Change the cooking actions in step ${step}.`;
  }
  if (fields.has("duration")) {
    return `Change the timing in step ${step}.`;
  }
  if (fields.has("temperature")) {
    return `Change the temperature in step ${step}.`;
  }
  return `Update step ${step}.`;
}

function cookingChangeSummaries(diff: RecipeDiff): string[] {
  const summaries: string[] = [];

  for (const change of diff.ingredients.replaced) {
    summaries.push(
      `Use ${ingredientWithMeasure(change.after)} instead of ${ingredientWithMeasure(
        change.before,
      )}.`,
    );
  }
  for (const change of diff.ingredients.modified) {
    summaries.push(`${ingredientChangeHeading(change)}.`);
  }
  for (const ingredient of diff.ingredients.added) {
    summaries.push(
      `Add ${ingredient.display_name} (${formatIngredientMeasure(ingredient.measure)}).`,
    );
  }
  for (const ingredient of diff.ingredients.removed) {
    summaries.push(
      `Remove ${ingredient.display_name} (${formatIngredientMeasure(ingredient.measure)}).`,
    );
  }
  for (const change of diff.instructions.modified) {
    summaries.push(instructionChangeSummary(change));
  }
  for (const instruction of diff.instructions.added) {
    summaries.push(
      `Add step ${instruction.display_order + 1}: ${instruction.text}`,
    );
  }
  for (const instruction of diff.instructions.removed) {
    summaries.push(
      `Remove step ${instruction.display_order + 1}: ${instruction.text}`,
    );
  }
  for (const change of diff.metadata_changes) {
    const label = metadataLabels[change.field].toLowerCase();
    summaries.push(
      `Change ${label} from ${metadataValue(change, change.before)} to ${metadataValue(
        change,
        change.after,
      )}.`,
    );
  }

  return summaries;
}

export function RecipeDiffView({ diff }: RecipeDiffViewProps) {
  const ingredientChanges = ingredientChangeCount(diff);
  const instructionChanges = instructionChangeCount(diff);
  const detailChanges = diff.metadata_changes.length;
  const totalChanges = ingredientChanges + instructionChanges + detailChanges;
  const summaries = cookingChangeSummaries(diff);
  const visibleSummaries = summaries.slice(0, 3);
  const remainingSummaries = Math.max(
    0,
    summaries.length - visibleSummaries.length,
  );
  const pageHeadingId = `recipe-diff-heading-${diff.target_version.id}`;

  return (
    <article className="recipe-diff-view" aria-labelledby={pageHeadingId}>
      <header className="recipe-diff-view__header">
        <p className="eyebrow">Recipe comparison</p>
        <h1 id={pageHeadingId}>How {diff.target_version.title} changed</h1>
        <p className="recipe-diff-view__lede">
          Compared with {diff.base_version.title}. Start with the main cooking
          changes, then review every recorded detail below.
        </p>
        <nav className="recipe-diff-versions" aria-label="Compared recipes">
          <ol>
            <li>
              <Link
                href={`/recipes/${encodeURIComponent(diff.base_version.id)}`}
              >
                <span>Starting recipe</span>
                <strong>{diff.base_version.title}</strong>
              </Link>
            </li>
            <li>
              <Link
                href={`/recipes/${encodeURIComponent(diff.target_version.id)}`}
              >
                <span>This recipe</span>
                <strong>{diff.target_version.title}</strong>
              </Link>
            </li>
          </ol>
        </nav>
      </header>

      {!diff.has_changes ? (
        <section
          className="recipe-diff-empty"
          aria-labelledby="recipe-diff-empty-heading"
        >
          <p className="eyebrow">Comparison complete</p>
          <h2 id="recipe-diff-empty-heading">
            This recipe matches the starting recipe.
          </h2>
          <p>
            It has the same recipe details, ingredients, and cooking steps as{" "}
            {diff.base_version.title}.
          </p>
        </section>
      ) : (
        <div className="recipe-diff-content">
          <section
            className="recipe-diff-overview"
            aria-labelledby="recipe-diff-overview-heading"
          >
            <p className="eyebrow">
              {totalChanges} {totalChanges === 1 ? "change" : "changes"}
            </p>
            <h2 id="recipe-diff-overview-heading">Changes at a glance</h2>
            <ul
              className="recipe-diff-highlights"
              aria-label="Changes at a glance"
            >
              {visibleSummaries.map((summary) => (
                <li key={summary}>{summary}</li>
              ))}
            </ul>
            {remainingSummaries > 0 ? (
              <p className="recipe-diff-overview__remainder">
                {remainingSummaries} more{" "}
                {remainingSummaries === 1 ? "change is" : "changes are"} listed
                below.
              </p>
            ) : null}
          </section>

          {ingredientChanges > 0 ? (
            <section
              className="recipe-diff-group"
              aria-labelledby="ingredient-changes-heading"
            >
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
            <section
              className="recipe-diff-group"
              aria-labelledby="instruction-changes-heading"
            >
              <div className="section-heading section-heading--compact">
                <div>
                  <p className="eyebrow">Cooking steps</p>
                  <h2 id="instruction-changes-heading">Cooking step changes</h2>
                </div>
              </div>
              <ul className="recipe-diff-list">
                {diff.instructions.modified.map((change) => (
                  <ModifiedInstruction
                    key={`${change.before.id}:${change.after.id}`}
                    change={change}
                    beforeIngredients={diff.ingredient_context.base}
                    afterIngredients={diff.ingredient_context.target}
                  />
                ))}
                {diff.instructions.added.map((instruction) => (
                  <SingleInstructionChange
                    key={instruction.id}
                    instruction={instruction}
                    kind="added"
                    ingredients={diff.ingredient_context.target}
                  />
                ))}
                {diff.instructions.removed.map((instruction) => (
                  <SingleInstructionChange
                    key={instruction.id}
                    instruction={instruction}
                    kind="removed"
                    ingredients={diff.ingredient_context.base}
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
                  <h2 id="recipe-detail-changes-heading">Recipe details</h2>
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
