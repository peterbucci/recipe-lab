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

export function formatIngredientAmount(quantity: string | null, unit: string | null): string {
  if (quantity === null) {
    return "Amount not specified";
  }

  const amount = formatDecimal(quantity);
  if (unit === null || unit === "count") {
    return amount;
  }
  if ((unit === "slice" || unit === "clove") && amount !== "1") {
    return `${amount} ${unit}s`;
  }
  return `${amount} ${unit}`;
}

export function catalogNameForDisplay(
  displayName: string | null,
  canonicalName: string | null,
): string | null {
  const display = displayName?.trim();
  const canonical = canonicalName?.trim();
  if (!display || !canonical || display.toLowerCase() === canonical.toLowerCase()) {
    return null;
  }
  return canonical;
}
