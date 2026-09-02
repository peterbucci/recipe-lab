import type { RecipeIngredientMeasure } from "./structured-measure";
import type { RecipeDifficulty } from "./recipe-api";

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

export function formatRecipeDuration(minutes: number | null): string {
  if (minutes === null) {
    return "Not provided";
  }

  const wholeMinutes = Math.trunc(minutes);
  if (!Number.isFinite(minutes) || wholeMinutes <= 0) {
    return "Not provided";
  }

  const hours = Math.floor(wholeMinutes / 60);
  const remainingMinutes = wholeMinutes % 60;
  if (hours === 0) {
    return `${remainingMinutes} min`;
  }
  if (remainingMinutes === 0) {
    return `${hours} hr`;
  }
  return `${hours} hr ${remainingMinutes} min`;
}

export function formatRecipeDifficulty(
  difficulty: RecipeDifficulty | null,
): string {
  if (difficulty === null) {
    return "Not provided";
  }
  return difficulty[0].toUpperCase() + difficulty.slice(1);
}

export function formatIngredientMeasure(measure: RecipeIngredientMeasure): string {
  return measure.display;
}
