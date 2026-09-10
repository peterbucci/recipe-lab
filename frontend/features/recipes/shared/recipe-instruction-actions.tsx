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
