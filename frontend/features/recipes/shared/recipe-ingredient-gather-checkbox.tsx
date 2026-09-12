interface RecipeIngredientGatherCheckboxProps {
  disabled?: boolean;
  displayName: string;
}

export function RecipeIngredientGatherCheckbox({
  disabled = false,
  displayName,
}: RecipeIngredientGatherCheckboxProps) {
  return (
    <input
      aria-label={
        disabled
          ? `${displayName} was removed from this recipe version`
          : `Mark ${displayName} as gathered`
      }
      className="recipe-ingredient-gather-checkbox"
      disabled={disabled}
      type="checkbox"
    />
  );
}
