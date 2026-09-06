import { formatDecimal } from "../../shared/recipe-format";
import { recipeActionLabel } from "../../shared/recipe-instruction-actions";
import type { StructuredActionDraft } from "./structured-action";

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
