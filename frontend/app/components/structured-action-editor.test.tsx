import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

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
  it("keeps ordered actions keyboard reachable through boundary moves and removal", async () => {
    render(<Harness initial={[action("mix-action", 0), action("bake-action", 1)]} />);

    let actionSelects = screen.getAllByRole("combobox", { name: "Cooking action" });
    expect(actionSelects.map((select) => (select as HTMLSelectElement).value)).toEqual([
      MIX_ID,
      BAKE_ID,
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Move down action 1" }));
    actionSelects = screen.getAllByRole("combobox", { name: "Cooking action" });
    expect(actionSelects.map((select) => (select as HTMLSelectElement).value)).toEqual([
      BAKE_ID,
      MIX_ID,
    ]);
    await waitFor(() => expect(actionSelects[1]).toHaveFocus());
    expect(screen.getByRole("button", { name: "Move down action 2" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Move up action 2" }));
    actionSelects = screen.getAllByRole("combobox", { name: "Cooking action" });
    await waitFor(() => expect(actionSelects[0]).toHaveFocus());
    expect(screen.getByRole("button", { name: "Move up action 1" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Remove action 1" }));
    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: "Cooking action" })).toHaveFocus(),
    );
    expect(screen.getAllByRole("group", { name: /^Action \d+$/ })).toHaveLength(1);
  });

  it("selects distinct repeated ingredient occurrences and adds a focused action", async () => {
    render(<Harness />);

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

    fireEvent.click(screen.getByRole("button", { name: "Add cooking action" }));
    const selects = screen.getAllByRole("combobox", { name: "Cooking action" });
    expect(selects).toHaveLength(2);
    await waitFor(() => expect(selects[1]).toHaveFocus());
    fireEvent.change(selects[1], { target: { value: BAKE_ID } });
    expect(selects[1]).toHaveValue(BAKE_ID);
  });

  it("preserves raw duration and temperature values while optional controls are hidden", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("checkbox", { name: "Include duration" }));
    const duration = screen.getByRole("group", { name: "Duration for Action 1: mix" });
    fireEvent.change(within(duration).getByRole("textbox", { name: "Duration" }), {
      target: { value: "05.000" },
    });
    fireEvent.change(within(duration).getByRole("combobox", { name: "Unit" }), {
      target: { value: MINUTE_ID },
    });
    fireEvent.click(screen.getByRole("checkbox", { name: "Include duration" }));
    expect(screen.queryByRole("group", { name: "Duration for Action 1: mix" })).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Include duration" }));
    expect(
      within(screen.getByRole("group", { name: "Duration for Action 1: mix" })).getByRole(
        "textbox",
        { name: "Duration" },
      ),
    ).toHaveValue("05.000");

    fireEvent.click(screen.getByRole("checkbox", { name: "Include temperature" }));
    const temperature = screen.getByRole("group", {
      name: "Temperature for Action 1: mix",
    });
    expect(within(temperature).queryByRole("option", { name: /minute/i })).toBeNull();
    expect(within(temperature).getByRole("option", { name: /celsius/i })).toBeInTheDocument();
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

    const actionType = screen.getByRole("combobox", { name: "Cooking action" });
    expect(actionType).toHaveValue(RETIRED_ID);
    expect(within(actionType).getByRole("option", { name: /retired.*unavailable/i })).toBeDisabled();
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
          [structuredActionFieldKey(draft.key, "type")]: "Choose a supported action.",
          [structuredActionFieldKey(draft.key, "inputs")]: "Restore this ingredient.",
          [structuredActionFieldKey(draft.key, "duration", "amount")]:
            "Enter a duration.",
        }}
      />,
    );

    expect(
      screen.getByRole("group", { name: "Structured actions" }),
    ).toHaveAccessibleDescription(/Add at least one action\./);

    expect(screen.getByRole("combobox", { name: "Cooking action" })).toHaveAccessibleDescription(
      "Choose a supported action.",
    );
    expect(screen.getByRole("group", { name: "Ingredient inputs" })).toHaveAccessibleDescription(
      "Restore this ingredient.",
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Include duration" }));
    expect(screen.getByRole("textbox", { name: "Duration" })).toHaveAccessibleDescription(
      "Enter a duration.",
    );
  });
});
