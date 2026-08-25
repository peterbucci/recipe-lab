import type { RecipeIngredientMeasure } from "./structured-measure";

export function formatDecimal(value: string): string {
  const [whole, fraction] = value.split(".", 2);
  if (fraction === undefined) {
    return whole;
  }
  const trimmedFraction = fraction.replace(/0+$/, "");
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

export function formatServings(value: string): string {
  const servings = formatDecimal(value);
  return `${servings} ${servings === "1" ? "serving" : "servings"}`;
}

export function formatIngredientMeasure(measure: RecipeIngredientMeasure): string {
  return measure.display;
}
