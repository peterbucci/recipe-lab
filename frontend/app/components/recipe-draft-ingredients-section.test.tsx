import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { CatalogUnit } from "../../lib/measurement-unit-api";
import type { RecipeDraftIngredientState } from "../../lib/recipe-draft";
import { RecipeDraftIngredientsSection } from "./recipe-draft-ingredients-section";

const GRAM_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const SAGE_ID = "33333333-3333-4333-8333-333333333333";
type ReplaceIngredient = (
  key: string,
  ingredient: RecipeDraftIngredientState,
) => void;

const gram: CatalogUnit = {
  id: GRAM_ID,
  key: "gram",
  dimension: "mass",
  canonical_label: "gram",
  plural_label: "grams",
  symbol: "g",
  display_style: "symbol",
  aliases: ["grams"],
  active: true,
  provenance: "Test fixture",
};

function ingredient(): RecipeDraftIngredientState {
  return {
    key: "ingredient-row-one",
    selection: {
      kind: "request",
      request: {
        id: REQUEST_ID,
        proposed_name: "Garden sage",
        status: "approved",
        resolved_ingredient: {
          id: SAGE_ID,
          canonical_name: "Fresh sage",
          aliases: ["Garden sage"],
        },
      },
    },
    measure: {
      mode: "exact",
      exactValue: "2.5000",
      rangeMinimum: "",
      rangeMaximum: "",
      unit: {
        id: gram.id,
        key: gram.key,
        dimension: gram.dimension,
        canonical_label: gram.canonical_label,
        plural_label: gram.plural_label,
        symbol: gram.symbol,
        display_style: gram.display_style,
        active: gram.active,
      },
      packageSizeId: null,
    },
    preparationNotes: "finely chopped",
  };
}

function renderSection({
  disabled = false,
  row = ingredient(),
  onReplace = vi.fn<ReplaceIngredient>(),
}: {
  disabled?: boolean;
  row?: RecipeDraftIngredientState;
  onReplace?: ReplaceIngredient;
} = {}) {
  const view = render(
    <RecipeDraftIngredientsSection
      disabled={disabled}
      errors={{}}
      ingredients={[row]}
      measurementUnits={[gram]}
      onAdd={vi.fn()}
      onMove={vi.fn()}
      onRemove={vi.fn()}
      onReplace={onReplace}
    />,
  );
  return { ...view, row };
}

describe("RecipeDraftIngredientsSection", () => {
  it("orders the cooking-first fields as amount, unit, ingredient, then note", () => {
    const { container } = renderSection();
    const fields = container.querySelector(".draft-editor__ingredient-fields");

    expect(fields).not.toBeNull();
    expect(
      Array.from(fields?.querySelectorAll("input, select") ?? []).map(
        (control) => control.id,
      ),
    ).toEqual([
      "draft-ingredient-row-one-measure-amount",
      "draft-ingredient-row-one-measure-unit",
      "draft-ingredient-row-one-ingredient-search",
      "draft-ingredient-row-one-notes",
    ]);
  });

  it("replaces only the selection when an ingredient request is resolved", () => {
    const onReplace = vi.fn<ReplaceIngredient>();
    const { row } = renderSection({ onReplace });

    fireEvent.click(screen.getByRole("button", { name: "Use Fresh sage" }));

    expect(onReplace).toHaveBeenCalledOnce();
    const [key, replacement] = onReplace.mock.calls[0] as [
      string,
      RecipeDraftIngredientState,
    ];
    expect(key).toBe(row.key);
    expect(replacement.key).toBe(row.key);
    expect(replacement.measure).toBe(row.measure);
    expect(replacement.preparationNotes).toBe("finely chopped");
    expect(replacement.selection).toEqual({
      kind: "catalog",
      ingredient: {
        ingredientId: SAGE_ID,
        canonicalName: "Fresh sage",
        displayName: "Fresh sage",
      },
    });
  });

  it("disables amount, ingredient, note, and remove controls together", () => {
    renderSection({ disabled: true });

    expect(screen.getByRole("textbox", { name: "Amount" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Unit" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Ingredient" })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /Note/ })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /Remove.*ingredient 1/i }),
    ).toBeDisabled();
  });
});
