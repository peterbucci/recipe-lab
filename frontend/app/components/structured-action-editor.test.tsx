import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  catalogActionTypeSummary,
  type CatalogActionType,
} from "../../lib/cooking-action-api";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import {
  createStructuredActionDraft,
  structuredActionFieldKey,
  type IngredientOccurrenceOption,
  type StructuredActionDraft,
} from "../../lib/structured-action";
import { StructuredActionEditor } from "./structured-action-editor";

const MIX_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const BAKE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const RETIRED_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";
const MINUTE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const CELSIUS_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

const actionTypes: CatalogActionType[] = [
  {
    id: MIX_ID,
    key: "mix",
    canonical_verb: "mix",
    active: true,
    provenance: "Test fixture",
  },
  {
    id: BAKE_ID,
    key: "bake",
    canonical_verb: "bake",
    active: true,
    provenance: "Test fixture",
  },
];

const units: CatalogUnit[] = [
  {
    id: MINUTE_ID,
    key: "minute",
    dimension: "time",
    canonical_label: "minute",
    plural_label: "minutes",
    symbol: "min",
    display_style: "word",
    aliases: ["minutes"],
    active: true,
    provenance: "Test fixture",
  },
  {
    id: CELSIUS_ID,
    key: "celsius",
    dimension: "temperature",
    canonical_label: "degree Celsius",
    plural_label: "degrees Celsius",
    symbol: "°C",
    display_style: "symbol",
    aliases: ["Celsius"],
    active: true,
    provenance: "Test fixture",
  },
];

const occurrences: IngredientOccurrenceOption[] = [
  {
    key: "first-tomato",
    label: "Ingredient 1: Tomato, 1 cup",
    ref: { kind: "existing", recipe_ingredient_id: "first-tomato-id" },
    removed: false,
  },
  {
    key: "second-tomato",
    label: "Ingredient 2: Tomato, 2 cups",
    ref: { kind: "existing", recipe_ingredient_id: "second-tomato-id" },
    removed: false,
  },
];

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

function action(key: string, typeIndex: number): StructuredActionDraft {
  const draft = createStructuredActionDraft(key);
  draft.actionType = catalogActionTypeSummary(actionTypes[typeIndex]);
  return draft;
}

function Harness({
  initial = [action("mix-action", 0)],
  ingredientOccurrences = occurrences,
  errors = {},
}: {
  initial?: StructuredActionDraft[];
  ingredientOccurrences?: IngredientOccurrenceOption[];
  errors?: Record<string, string>;
}) {
  const [value, setValue] = useState(initial);
  return (
    <StructuredActionEditor
      idPrefix="step-one"
      stepLabel="Step 1"
      value={value}
      actionTypes={actionTypes}
      ingredientOccurrences={ingredientOccurrences}
      measurementUnits={units}
      errors={errors}
      onChange={setValue}
    />
  );
}

describe("StructuredActionEditor", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("keeps existing cooking details compact until their floating editor is opened", async () => {
    const mix = action("mix-action", 0);
    mix.ingredientKeys = ["first-tomato"];
    mix.duration = {
      enabled: true,
      value: {
        mode: "exact",
        exactValue: "05.000",
        rangeMinimum: "",
        rangeMaximum: "",
        unit: units[0],
        packageSizeId: null,
      },
    };
    render(<Harness initial={[mix]} />);

    const detail = screen.getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
    });
    expect(detail).toHaveAttribute("aria-expanded", "false");
    expect(detail).toHaveTextContent("Mix");
    expect(detail).toHaveTextContent("Tomato, 1 cup · 5 minutes");
    expect(
      screen.queryByRole("combobox", { name: "Cooking action" }),
    ).toBeNull();

    fireEvent.click(detail);
    expect(detail).toHaveAttribute("aria-expanded", "true");
    const editor = screen.getByRole("dialog", {
      name: "Cooking detail 1 for Step 1",
    });
    expect(editor).toHaveAttribute("data-placement", "below");
    expect(editor).toHaveTextContent(/cooking breakdown/i);
    await waitFor(() =>
      expect(
        within(editor).getByRole("combobox", { name: "Cooking action" }),
      ).toHaveFocus(),
    );
  });

  it("adds an optional cooking detail from the text control and focuses its catalog action", async () => {
    render(<Harness initial={[]} />);

    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Add cooking detail to Step 1" }),
    );

    const editor = screen.getByRole("dialog", {
      name: "Cooking detail 1 for Step 1",
    });
    const actionType = within(editor).getByRole("combobox", {
      name: "Cooking action",
    });
    expect(
      within(actionType).getByRole("option", { name: "mix" }),
    ).toBeVisible();
    expect(
      within(actionType).getByRole("option", { name: "bake" }),
    ).toBeVisible();
    await waitFor(() => expect(actionType).toHaveFocus());
  });

  it("flips the floating editor above when it would leave the bottom of the viewport", async () => {
    vi.stubGlobal("innerHeight", 600);
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.classList.contains("cooking-details__trigger")) {
          return elementBounds(520, 560);
        }
        if (this.classList.contains("cooking-details__popover")) {
          return elementBounds(566, 866);
        }
        return elementBounds(0, 0);
      },
    );
    render(<Harness />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Edit cooking detail 1 for Step 1",
      }),
    );

    const editor = screen.getByRole("dialog", {
      name: "Cooking detail 1 for Step 1",
    });
    await waitFor(() =>
      expect(editor).toHaveAttribute("data-placement", "above"),
    );
    expect(editor.style.getPropertyValue("--floating-panel-max-height")).toBe(
      "498px",
    );
  });

  it("reorders and removes compact details through the shared icon controls", async () => {
    render(
      <Harness initial={[action("mix-action", 0), action("bake-action", 1)]} />,
    );

    expect(
      screen.getByRole("button", { name: "Move cooking detail 1 up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move cooking detail 2 down" }),
    ).toBeDisabled();
    expect(
      screen
        .getAllByRole("button", { name: /Edit cooking detail \d for Step 1/ })
        .map((button) => button.textContent),
    ).toEqual([
      expect.stringContaining("Mix"),
      expect.stringContaining("Bake"),
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Move cooking detail 1 down" }),
    );
    expect(
      screen
        .getAllByRole("button", { name: /Edit cooking detail \d for Step 1/ })
        .map((button) => button.textContent),
    ).toEqual([
      expect.stringContaining("Bake"),
      expect.stringContaining("Mix"),
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Move cooking detail 2 up" }),
    );
    expect(
      screen
        .getAllByRole("button", { name: /Edit cooking detail \d for Step 1/ })
        .map((button) => button.textContent),
    ).toEqual([
      expect.stringContaining("Mix"),
      expect.stringContaining("Bake"),
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Remove cooking detail 1" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Edit cooking detail 1 for Step 1",
        }),
      ).toHaveFocus(),
    );
    expect(
      screen.getAllByRole("button", {
        name: /Edit cooking detail \d for Step 1/,
      }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Edit cooking detail 1 for Step 1" }),
    ).toHaveTextContent("Bake");
  });

  it("selects distinct repeated ingredient occurrences and adds a focused action", async () => {
    render(<Harness />);
    fireEvent.click(
      screen.getByRole("button", { name: "Edit cooking detail 1 for Step 1" }),
    );

    const firstTomato = screen.getByRole("checkbox", {
      name: "Ingredient 1: Tomato, 1 cup",
    });
    const secondTomato = screen.getByRole("checkbox", {
      name: "Ingredient 2: Tomato, 2 cups",
    });
    fireEvent.click(firstTomato);
    fireEvent.click(secondTomato);
    expect(firstTomato).toBeChecked();
    expect(secondTomato).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Add cooking detail to Step 1" }),
    );
    const secondEditor = screen.getByRole("dialog", {
      name: "Cooking detail 2 for Step 1",
    });
    const secondSelect = within(secondEditor).getByRole("combobox", {
      name: "Cooking action",
    });
    await waitFor(() => expect(secondSelect).toHaveFocus());
    fireEvent.change(secondSelect, { target: { value: BAKE_ID } });
    expect(secondSelect).toHaveValue(BAKE_ID);
  });

  it("preserves raw measures across Done and Escape while keeping them compact when closed", async () => {
    render(<Harness />);
    const detail = screen.getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
    });
    fireEvent.click(detail);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include duration" }));
    const duration = screen.getByRole("group", {
      name: "Duration for Cooking detail 1: mix",
    });
    fireEvent.change(
      within(duration).getByRole("textbox", { name: "Duration" }),
      {
        target: { value: "05.000" },
      },
    );
    fireEvent.change(within(duration).getByRole("combobox", { name: "Unit" }), {
      target: { value: MINUTE_ID },
    });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.queryByRole("group", {
        name: "Duration for Cooking detail 1: mix",
      }),
    ).toBeNull();
    expect(detail).toHaveTextContent("5 minutes");
    expect(detail).toHaveFocus();

    fireEvent.click(detail);
    expect(
      within(
        screen.getByRole("group", {
          name: "Duration for Cooking detail 1: mix",
        }),
      ).getByRole("textbox", { name: "Duration" }),
    ).toHaveValue("05.000");

    fireEvent.click(screen.getByRole("checkbox", { name: "Include duration" }));
    expect(
      screen.queryByRole("group", {
        name: "Duration for Cooking detail 1: mix",
      }),
    ).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include duration" }));
    expect(
      within(
        screen.getByRole("group", {
          name: "Duration for Cooking detail 1: mix",
        }),
      ).getByRole("textbox", { name: "Duration" }),
    ).toHaveValue("05.000");

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include temperature" }),
    );
    const temperature = screen.getByRole("group", {
      name: "Temperature for Cooking detail 1: mix",
    });
    expect(
      within(temperature).queryByRole("option", { name: /minute/i }),
    ).toBeNull();
    expect(
      within(temperature).getByRole("option", { name: /celsius/i }),
    ).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(detail).toHaveFocus());
    fireEvent.click(detail);
    expect(
      within(
        screen.getByRole("group", {
          name: "Duration for Cooking detail 1: mix",
        }),
      ).getByRole("textbox", { name: "Duration" }),
    ).toHaveValue("05.000");
  });

  it("renders inherited inactive types and removed inputs without silently dropping either", () => {
    const retired = action("retired-action", 0);
    retired.actionType = {
      id: RETIRED_ID,
      key: "retired",
      canonical_verb: "retired",
      active: false,
    };
    retired.ingredientKeys = ["first-tomato"];
    render(
      <Harness
        initial={[retired]}
        ingredientOccurrences={occurrences.map((item) =>
          item.key === "first-tomato" ? { ...item, removed: true } : item,
        )}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Edit cooking detail 1 for Step 1" }),
    );

    const actionType = screen.getByRole("combobox", { name: "Cooking action" });
    expect(actionType).toHaveValue(RETIRED_ID);
    expect(
      within(actionType).getByRole("option", { name: /retired.*unavailable/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("checkbox", {
        name: "Ingredient 1: Tomato, 1 cup — marked for removal",
      }),
    ).toBeChecked();

    const removedInput = screen.getByRole("checkbox", {
      name: "Ingredient 1: Tomato, 1 cup — marked for removal",
    });
    expect(removedInput).toBeEnabled();
    fireEvent.click(removedInput);
    expect(removedInput).not.toBeChecked();
    expect(removedInput).toBeDisabled();
  });

  it("connects action errors to the exact native controls", () => {
    const draft = action("mix-action", 0);
    render(
      <Harness
        initial={[draft]}
        errors={{
          actions: "Add at least one action.",
          [structuredActionFieldKey(draft.key, "type")]:
            "Choose a supported action.",
          [structuredActionFieldKey(draft.key, "inputs")]:
            "Restore this ingredient.",
          [structuredActionFieldKey(draft.key, "duration", "amount")]:
            "Enter a duration.",
        }}
      />,
    );

    expect(screen.getByText("Add at least one action.")).toBeVisible();
    const detail = screen.getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
    });
    expect(detail).toHaveAttribute("aria-expanded", "true");
    expect(detail).toHaveAccessibleDescription(
      "This cooking detail needs attention.",
    );
    expect(
      screen.getByRole("dialog", { name: "Cooking detail 1 for Step 1" }),
    ).toBeVisible();

    expect(
      screen.getByRole("combobox", { name: "Cooking action" }),
    ).toHaveAccessibleDescription("Choose a supported action.");
    expect(
      screen.getByRole("group", { name: "Ingredient inputs" }),
    ).toHaveAccessibleDescription("Restore this ingredient.");
    fireEvent.click(screen.getByRole("checkbox", { name: "Include duration" }));
    expect(
      screen.getByRole("textbox", { name: "Duration" }),
    ).toHaveAccessibleDescription("Enter a duration.");
  });
});
