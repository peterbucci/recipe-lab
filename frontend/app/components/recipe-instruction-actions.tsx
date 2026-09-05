import { formatDecimal } from "../../lib/format";
import type { RecipeIngredient } from "../../lib/recipe-api";
import type {
  RecipeInstructionAction,
  StructuredActionDraft,
} from "../../lib/structured-action";

interface RecipeInstructionActionsProps {
  actions: readonly RecipeInstructionAction[];
  ingredients: readonly RecipeIngredient[];
  label: string;
}

interface RecipeInstructionFactPillsProps {
  facts: readonly string[];
  label: string;
}

export function recipeActionLabel(canonicalVerb: string): string {
  const trimmed = canonicalVerb.trim();
  const label = trimmed.toLocaleLowerCase() === "line" ? "line pan" : trimmed;
  return label.length > 0
    ? `${label.charAt(0).toLocaleUpperCase()}${label.slice(1)}`
    : label;
}

export function draftActionMeasureLabel(
  measure: StructuredActionDraft["duration"],
): string | null {
  if (!measure.enabled || !measure.value.unit) {
    return null;
  }
  const { unit } = measure.value;
  const displayDecimal = (value: string) => {
    const formatted = formatDecimal(value);
    const negative = formatted.startsWith("-");
    const unsigned = negative ? formatted.slice(1) : formatted;
    const normalized = unsigned.replace(/^0+(?=\d)/, "");
    return `${negative ? "-" : ""}${normalized}`;
  };
  const amount =
    measure.value.mode === "exact"
      ? displayDecimal(measure.value.exactValue.trim())
      : measure.value.mode === "range"
        ? `${displayDecimal(measure.value.rangeMinimum.trim())}\u2013${displayDecimal(
            measure.value.rangeMaximum.trim(),
          )}`
        : "";
  if (!amount || amount.startsWith("\u2013") || amount.endsWith("\u2013")) {
    return null;
  }
  if (unit.display_style === "symbol" && unit.symbol) {
    return `${amount} ${unit.symbol}`;
  }
  const singular = !amount.includes("\u2013") && Number(amount) === 1;
  return `${amount} ${singular ? unit.canonical_label : unit.plural_label}`;
}

export function recipeDraftStepFacts(
  actions: readonly StructuredActionDraft[],
): string[] {
  const facts = actions.flatMap((action) => {
    if (!action.actionType) {
      return [];
    }
    const details = [
      draftActionMeasureLabel(action.duration),
      draftActionMeasureLabel(action.temperature),
    ].filter((detail): detail is string => Boolean(detail));
    return [
      [recipeActionLabel(action.actionType.canonical_verb), ...details].join(
        " \u00b7 ",
      ),
    ];
  });
  return [...new Set(facts)];
}

export function RecipeInstructionFactPills({
  facts,
  label,
}: RecipeInstructionFactPillsProps) {
  if (facts.length === 0) {
    return null;
  }
  return (
    <ul className="recipe-instructions__facts" aria-label={label}>
      {facts.map((fact) => (
        <li key={fact}>{fact}</li>
      ))}
    </ul>
  );
}

export function RecipeInstructionActions({
  actions,
  ingredients,
  label,
}: RecipeInstructionActionsProps) {
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
          const inputLabels = action.ingredient_occurrence_ids.map((id) => {
            const ingredient = ingredientById.get(id);
            return ingredient
              ? ingredient.display_name
              : "ingredient no longer available";
          });
          const details = [
            inputLabels.length > 0 ? `With ${inputLabels.join(" and ")}` : null,
            action.duration ? `For ${action.duration.display}` : null,
            action.temperature ? `At ${action.temperature.display}` : null,
          ].filter((detail): detail is string => Boolean(detail));
          return (
            <li key={action.id}>
              <strong>
                {recipeActionLabel(action.action_type.canonical_verb)}
              </strong>
              {!action.action_type.active ? (
                <span>Previously used action</span>
              ) : null}
              {details.length > 0 ? (
                <small>{details.join(" \u00b7 ")}</small>
              ) : null}
            </li>
          );
        })}
    </ol>
  );
}
