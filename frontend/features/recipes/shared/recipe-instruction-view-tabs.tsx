"use client";

import { useRovingTabs } from "../../../shared/ui/use-roving-tabs";

export type RecipeInstructionView = "steps" | "breakdown";

const RECIPE_INSTRUCTION_VIEWS: readonly RecipeInstructionView[] = [
  "steps",
  "breakdown",
];

interface RecipeInstructionViewTabsProps {
  ariaLabel: string;
  hideOnPrint?: boolean;
  idPrefix: string;
  onChange: (view: RecipeInstructionView) => void;
  value: RecipeInstructionView;
}

export function recipeInstructionViewTabId(
  idPrefix: string,
  view: RecipeInstructionView,
): string {
  return `${idPrefix}-${view}-tab`;
}

export function recipeInstructionViewPanelId(
  idPrefix: string,
  view: RecipeInstructionView,
): string {
  return `${idPrefix}-${view}-panel`;
}

export function RecipeInstructionViewTabs({
  ariaLabel,
  hideOnPrint = false,
  idPrefix,
  onChange,
  value,
}: RecipeInstructionViewTabsProps) {
  const { getTabProps } = useRovingTabs({
    onChange,
    value,
    values: RECIPE_INSTRUCTION_VIEWS,
  });

  return (
    <div
      className={
        hideOnPrint
          ? "recipe-instruction-view-tabs recipe-instruction-view-tabs--print-hidden"
          : "recipe-instruction-view-tabs"
      }
      role="tablist"
      aria-label={ariaLabel}
    >
      {RECIPE_INSTRUCTION_VIEWS.map((candidate) => (
        <button
          {...getTabProps(candidate)}
          id={recipeInstructionViewTabId(idPrefix, candidate)}
          key={candidate}
          type="button"
          role="tab"
          aria-controls={recipeInstructionViewPanelId(idPrefix, candidate)}
          onClick={() => onChange(candidate)}
        >
          {candidate === "steps" ? "Steps" : "Cooking breakdown"}
        </button>
      ))}
    </div>
  );
}
