import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

function elementBounds(top: number, bottom: number): DOMRect {
  return {
    bottom,
    height: bottom - top,
    left: 0,
    right: 320,
    top,
    width: 320,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

function ingredient({
  key = "ingredient-row-one",
  preparationNotes = "finely chopped",
}: {
  key?: string;
  preparationNotes?: string;
} = {}): RecipeDraftIngredientState {
  return {
    key,
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
    preparationNotes,
  };
}

function pendingIngredient(proposedName: string): RecipeDraftIngredientState {
  const row = ingredient({ preparationNotes: "" });
  return {
    ...row,
    selection: {
      kind: "request",
      request: {
        id: REQUEST_ID,
        proposed_name: proposedName,
        status: "pending",
        resolved_ingredient: null,
      },
    },
  };
}

function renderSection({
  disabled = false,
  rows = [ingredient()],
  onAdd = vi.fn(),
  onMove = vi.fn(),
  onRemove = vi.fn(),
  onReplace = vi.fn<ReplaceIngredient>(),
}: {
  disabled?: boolean;
  rows?: RecipeDraftIngredientState[];
  onAdd?: () => void;
  onMove?: (index: number, direction: -1 | 1) => void;
  onRemove?: (index: number) => void;
  onReplace?: ReplaceIngredient;
} = {}) {
  const renderRows = (nextRows: RecipeDraftIngredientState[]) => (
    <RecipeDraftIngredientsSection
      disabled={disabled}
      errors={{}}
      ingredients={nextRows}
      measurementUnits={[gram]}
      onAdd={onAdd}
      onMeasureChange={(key, measure) => {
        const current = nextRows.find((row) => row.key === key);
        if (current) onReplace(key, { ...current, measure });
      }}
      onMove={onMove}
      onNotesChange={(key, preparationNotes) => {
        const current = nextRows.find((row) => row.key === key);
        if (current) onReplace(key, { ...current, preparationNotes });
      }}
      onRemove={onRemove}
      onSelectionChange={(key, selection) => {
        const current = nextRows.find((row) => row.key === key);
        if (current) onReplace(key, { ...current, selection });
      }}
    />
  );
  const view = render(renderRows(rows));
  return {
    ...view,
    rows,
    rerenderRows: (nextRows: RecipeDraftIngredientState[]) =>
      view.rerender(renderRows(nextRows)),
  };
}

describe("RecipeDraftIngredientsSection", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps each ingredient's amount, name, and icon actions in one compact line", () => {
    const { container } = renderSection();
    const row = screen.getByRole("group", { name: "Ingredient 1" });
    const line = row.querySelector(".recipe-workspace__ingredient-line");

    expect(line).not.toBeNull();
    expect(
      within(line as HTMLElement).getByRole("button", {
        name: "Edit amount for ingredient 1",
      }),
    ).toBeVisible();
    const ingredientName = within(line as HTMLElement).getByRole("combobox", {
      name: "Ingredient",
    });
    expect(ingredientName).toBeVisible();
    expect(ingredientName).toHaveClass("recipe-workspace__editable-text");
    expect(
      within(line as HTMLElement).getByRole("button", {
        name: "Move ingredient 1 up",
      }),
    ).toBeVisible();
    expect(
      within(line as HTMLElement).getByRole("button", {
        name: "Move ingredient 1 down",
      }),
    ).toBeVisible();
    expect(
      within(line as HTMLElement).getByRole("button", {
        name: "Ingredient 1 options",
      }),
    ).toHaveAttribute("aria-haspopup", "menu");
    expect(
      within(line as HTMLElement).queryByRole("menuitem", {
        name: "Delete ingredient",
      }),
    ).toBeNull();

    expect(
      container.querySelector(".draft-editor__ingredient-fields"),
    ).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Amount" })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Unit" })).toBeNull();
    expect(screen.queryByText("Selected ingredient")).toBeNull();
    expect(screen.queryByText("More amount options")).toBeNull();
  });

  it("keeps a pending ingredient name unobstructed and places its status below", () => {
    const proposedName = "Test Ingredient With A Long Descriptive Name";
    renderSection({ rows: [pendingIngredient(proposedName)] });

    const input = screen.getByRole("combobox", { name: "Ingredient" });
    const status = screen.getByText("Pending review", { selector: "span" });
    const combobox = input.closest(".ingredient-picker__combobox");

    expect(input).toHaveValue(proposedName);
    expect(input).not.toHaveClass("has-request-state");
    expect(combobox).not.toContainElement(status);
    expect(combobox?.nextElementSibling).toBe(status);
  });

  it("opens amount, unit, and amount-type controls in a floating editor", () => {
    const onReplace = vi.fn<ReplaceIngredient>();
    renderSection({ onReplace });

    fireEvent.click(
      screen.getByRole("button", { name: "Edit amount for ingredient 1" }),
    );

    const editor = screen.getByRole("dialog", {
      name: "Amount for ingredient 1",
    });
    expect(editor).toHaveAttribute("data-placement", "below");
    expect(within(editor).getByRole("textbox", { name: "Amount" })).toHaveValue(
      "2.5000",
    );
    expect(within(editor).getByRole("combobox", { name: "Unit" })).toHaveValue(
      gram.id,
    );
    fireEvent.click(
      within(editor).getByRole("button", { name: "More amount options" }),
    );
    expect(within(editor).getByRole("radio", { name: "Exact" })).toBeChecked();

    fireEvent.change(within(editor).getByRole("textbox", { name: "Amount" }), {
      target: { value: "3" },
    });
    expect(onReplace).toHaveBeenLastCalledWith(
      "ingredient-row-one",
      expect.objectContaining({
        measure: expect.objectContaining({ exactValue: "3" }),
      }),
    );

    fireEvent.click(within(editor).getByRole("button", { name: "Done" }));
    expect(
      screen.queryByRole("dialog", { name: "Amount for ingredient 1" }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit amount for ingredient 1" }),
    );
    fireEvent.keyDown(
      screen.getByRole("dialog", { name: "Amount for ingredient 1" }),
      { key: "Escape" },
    );
    expect(
      screen.queryByRole("dialog", { name: "Amount for ingredient 1" }),
    ).toBeNull();
  });

  it("flips the amount editor above when it would overflow the viewport", async () => {
    vi.stubGlobal("innerHeight", 600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("ingredient-amount__trigger")) {
          return elementBounds(500, 540);
        }
        if (this.classList.contains("ingredient-amount__popover")) {
          return elementBounds(546, 806);
        }
        return elementBounds(0, 0);
      },
    );
    renderSection();

    fireEvent.click(
      screen.getByRole("button", { name: "Edit amount for ingredient 1" }),
    );

    const editor = screen.getByRole("dialog", {
      name: "Amount for ingredient 1",
    });
    await waitFor(() =>
      expect(editor).toHaveAttribute("data-placement", "above"),
    );
    expect(editor.style.getPropertyValue("--floating-panel-max-height")).toBe(
      "478px",
    );
  });

  it("moves and removes rows through icon buttons with explicit accessible names", () => {
    const onMove = vi.fn<(index: number, direction: -1 | 1) => void>();
    const onRemove = vi.fn<(index: number) => void>();
    renderSection({
      rows: [
        ingredient(),
        ingredient({ key: "ingredient-row-two", preparationNotes: "" }),
      ],
      onMove,
      onRemove,
    });

    expect(
      screen.getByRole("button", { name: "Move ingredient 1 up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move ingredient 2 down" }),
    ).toBeDisabled();

    fireEvent.click(
      screen.getByRole("button", { name: "Move ingredient 1 down" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Move ingredient 2 up" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Ingredient 1 options" }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Delete ingredient" }),
    );

    expect(onMove).toHaveBeenNthCalledWith(1, 0, 1);
    expect(onMove).toHaveBeenNthCalledWith(2, 1, -1);
    expect(onRemove).toHaveBeenCalledWith(0);
  });

  it("shows notes only when enabled and clears an existing note when disabled", async () => {
    const onReplace = vi.fn<ReplaceIngredient>();
    const rows = [
      ingredient(),
      ingredient({ key: "ingredient-row-two", preparationNotes: "" }),
    ];
    const { rerenderRows } = renderSection({
      rows,
      onReplace,
    });

    expect(
      screen.getByRole("textbox", {
        name: "Note for ingredient 1 (optional)",
      }),
    ).toHaveValue("finely chopped");
    expect(
      screen.queryByRole("textbox", {
        name: "Note for ingredient 2 (optional)",
      }),
    ).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Ingredient 2 options" }),
    );
    const showSecondNote = screen.getByRole("menuitemcheckbox", {
      name: "Show note for ingredient 2",
    });
    expect(showSecondNote).toHaveAttribute("aria-checked", "false");
    fireEvent.click(showSecondNote);

    const note = screen.getByRole("textbox", {
      name: "Note for ingredient 2 (optional)",
    });
    expect(note).toBeVisible();
    expect(note).toHaveAttribute("placeholder", "Note (optional)");
    expect(note).toHaveClass("recipe-workspace__editable-text");

    fireEvent.change(note, { target: { value: "peeled and sliced" } });
    expect(onReplace).toHaveBeenLastCalledWith(
      "ingredient-row-two",
      expect.objectContaining({ preparationNotes: "peeled and sliced" }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Ingredient 1 options" }),
    );
    const hideFirstNote = screen.getByRole("menuitemcheckbox", {
      name: "Show note for ingredient 1",
    });
    expect(hideFirstNote).toHaveAttribute("aria-checked", "true");
    fireEvent.click(hideFirstNote);
    rerenderRows([
      { ...rows[0], preparationNotes: "" },
      rows[1],
    ] as RecipeDraftIngredientState[]);

    expect(
      screen.queryByRole("textbox", {
        name: "Note for ingredient 1 (optional)",
      }),
    ).toBeNull();
    expect(onReplace).toHaveBeenLastCalledWith(
      "ingredient-row-one",
      expect.objectContaining({ preparationNotes: "" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Ingredient 1 options" }),
      ).toHaveFocus(),
    );
  });

  it("keeps an enabled note visible when cleared and reveals later saved content", () => {
    const onReplace = vi.fn<ReplaceIngredient>();
    const { rerenderRows } = renderSection({ onReplace });
    const note = screen.getByRole("textbox", {
      name: "Note for ingredient 1 (optional)",
    });

    fireEvent.change(note, { target: { value: "" } });
    rerenderRows([ingredient({ preparationNotes: "" })]);

    expect(
      screen.getByRole("textbox", {
        name: "Note for ingredient 1 (optional)",
      }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Ingredient 1 options" }),
    );
    fireEvent.click(
      screen.getByRole("menuitemcheckbox", {
        name: "Show note for ingredient 1",
      }),
    );
    expect(
      screen.queryByRole("textbox", {
        name: "Note for ingredient 1 (optional)",
      }),
    ).toBeNull();

    rerenderRows([ingredient({ preparationNotes: "saved note" })]);
    expect(
      screen.getByRole("textbox", {
        name: "Note for ingredient 1 (optional)",
      }),
    ).toHaveValue("saved note");
  });

  it("closes the ingredient settings menu with Escape and outside clicks", async () => {
    renderSection({
      rows: [ingredient({ preparationNotes: "" })],
    });
    const settings = screen.getByRole("button", {
      name: "Ingredient 1 options",
    });

    fireEvent.click(settings);
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemcheckbox", {
          name: "Show note for ingredient 1",
        }),
      ).toHaveFocus(),
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    await waitFor(() => expect(settings).toHaveFocus());

    fireEvent.click(settings);
    expect(screen.getByRole("menu")).toBeVisible();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("adds another ingredient from the text control below the list", () => {
    const onAdd = vi.fn();
    renderSection({ onAdd });

    const add = screen.getByRole("button", { name: "Add ingredient" });
    expect(add).toBeVisible();
    expect(add).toHaveAttribute("aria-label", "Add ingredient");
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledOnce();
  });

  it("offers an approved request resolution inside the single ingredient picker", () => {
    const onReplace = vi.fn<ReplaceIngredient>();
    const { rows } = renderSection({ onReplace });
    const [row] = rows;

    expect(screen.queryByText("Selected ingredient")).toBeNull();
    expect(screen.queryByText("Choose a different ingredient")).toBeNull();
    fireEvent.focus(screen.getByRole("combobox", { name: "Ingredient" }));
    fireEvent.click(
      screen.getByRole("option", {
        name: /Fresh sage/i,
      }),
    );

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

  it("disables amount, ingredient, note, and row actions together", () => {
    renderSection({ disabled: true });

    expect(
      screen.getByRole("button", { name: "Edit amount for ingredient 1" }),
    ).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Ingredient" })).toBeDisabled();
    expect(
      screen.getByRole("textbox", {
        name: "Note for ingredient 1 (optional)",
      }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move ingredient 1 up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Ingredient 1 options" }),
    ).toBeDisabled();
  });
});
