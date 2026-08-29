import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import type { CatalogUnit } from "../../lib/measurement-unit-api";
import {
  createBlankExactMeasureDraft,
  type StructuredMeasureDraft,
} from "../../lib/structured-measure";
import { IngredientAmountControl } from "./ingredient-amount-control";
import {
  DurationMeasureControl,
  TemperatureMeasureControl,
} from "./structured-measure-control";

const units: CatalogUnit[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    key: "gram",
    dimension: "mass",
    canonical_label: "gram",
    plural_label: "grams",
    symbol: "g",
    display_style: "symbol",
    aliases: ["grams"],
    active: true,
    provenance: "Test fixture",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
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
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
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
  {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    key: "can",
    dimension: "package",
    canonical_label: "can",
    plural_label: "cans",
    symbol: null,
    display_style: "word",
    aliases: ["cans"],
    active: true,
    provenance: "Test fixture",
  },
];

function Harness({
  initial = createBlankExactMeasureDraft(),
  catalogUnits = units,
}: {
  initial?: StructuredMeasureDraft;
  catalogUnits?: CatalogUnit[];
}) {
  const [value, setValue] = useState(initial);
  return (
    <IngredientAmountControl
      idPrefix="ingredient-one-measure"
      label="Amount"
      contextLabel="Ingredient 1: Sugar"
      value={value}
      units={catalogUnits}
      onChange={setValue}
    />
  );
}

describe("structured measure controls", () => {
  it("starts with familiar amount and unit fields and retains every raw branch", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: "Amount for Ingredient 1: Sugar" });
    expect(within(group).getByRole("textbox", { name: "Amount" })).toHaveValue("");
    expect(within(group).getByRole("combobox", { name: "Unit" })).toHaveValue("");
    expect(
      within(within(group).getByRole("combobox", { name: "Unit" })).queryByRole(
        "option",
        { name: /can/i },
      ),
    ).toBeNull();

    fireEvent.change(within(group).getByRole("textbox", { name: "Amount" }), {
      target: { value: "1.2500" },
    });
    fireEvent.change(within(group).getByRole("combobox", { name: "Unit" }), {
      target: { value: units[0].id },
    });

    fireEvent.click(within(group).getByRole("button", { name: "More amount options" }));
    expect(within(group).getByRole("radio", { name: "Exact" })).toBeChecked();
    expect(
      within(within(group).getByRole("combobox", { name: "Unit" })).getByRole(
        "option",
        { name: /can/i },
      ),
    ).toBeVisible();
    fireEvent.click(within(group).getByRole("radio", { name: "Range" }));
    fireEvent.change(within(group).getByRole("textbox", { name: "Minimum amount" }), {
      target: { value: "1" },
    });
    fireEvent.change(within(group).getByRole("textbox", { name: "Maximum amount" }), {
      target: { value: "2" },
    });
    fireEvent.click(within(group).getByRole("radio", { name: "To taste" }));
    expect(within(group).queryByRole("combobox", { name: "Unit" })).toBeNull();

    fireEvent.click(within(group).getByRole("radio", { name: "Exact" }));
    expect(within(group).getByRole("textbox", { name: "Amount" })).toHaveValue("1.2500");
    expect(within(group).getByRole("combobox", { name: "Unit" })).toHaveValue(units[0].id);
    fireEvent.click(within(group).getByRole("radio", { name: "Range" }));
    expect(within(group).getByRole("textbox", { name: "Minimum amount" })).toHaveValue("1");
    expect(within(group).getByRole("textbox", { name: "Maximum amount" })).toHaveValue("2");
  });

  it("reveals saved advanced values with a plain-language summary without exposing IDs", () => {
    const packageSizeId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const { rerender } = render(
      <IngredientAmountControl
        idPrefix="advanced-measure"
        label="Amount"
        value={{
          mode: "range",
          exactValue: "",
          rangeMinimum: "1",
          rangeMaximum: "2.5",
          unit: units[0],
          packageSizeId: null,
        }}
        units={units}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByText("1–2.5 g")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Minimum amount" })).toHaveValue("1");

    rerender(
      <IngredientAmountControl
        idPrefix="advanced-measure"
        label="Amount"
        value={{
          mode: "exact",
          exactValue: "2",
          rangeMinimum: "",
          rangeMaximum: "",
          unit: units[3],
          packageSizeId,
        }}
        units={units}
        onChange={() => undefined}
      />,
    );

    expect(screen.getByText(/package details preserved/i)).toBeVisible();
    expect(screen.getByText(/stay attached unless you change the unit/i)).toBeVisible();
    expect(screen.queryByText(packageSizeId)).toBeNull();
  });

  it("shows an unavailable historical unit but prevents choosing it again", () => {
    const unavailable = { ...units[0], active: false };
    render(
      <Harness
        catalogUnits={units.filter((unit) => unit.id !== unavailable.id)}
        initial={{
          mode: "exact",
          exactValue: "2",
          rangeMinimum: "",
          rangeMaximum: "",
          unit: unavailable,
          packageSizeId: null,
        }}
      />,
    );
    const unit = screen.getByRole("combobox", { name: "Unit" });
    expect(unit).toHaveValue(unavailable.id);
    expect(within(unit).getByRole("option", { name: /gram.*unavailable/i })).toBeDisabled();
  });

  it("connects leaf errors to invalid native fields", () => {
    render(
      <IngredientAmountControl
        idPrefix="errored-measure"
        label="Amount"
        value={{
          mode: "range",
          exactValue: "",
          rangeMinimum: "2",
          rangeMaximum: "1",
          unit: null,
          packageSizeId: null,
        }}
        units={units}
        errors={{ maximum: "Maximum must follow minimum.", unit: "Choose a unit." }}
        onChange={() => undefined}
      />,
    );
    expect(screen.getByRole("textbox", { name: "Maximum amount" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("combobox", { name: "Unit" })).toHaveAccessibleDescription(
      "Choose a unit.",
    );
  });

  it("filters units and qualitative choices for duration and temperature wrappers", () => {
    const value: StructuredMeasureDraft = {
      mode: "exact",
      exactValue: "5",
      rangeMinimum: "",
      rangeMaximum: "",
      unit: null,
      packageSizeId: null,
    };
    render(
      <>
        <DurationMeasureControl
          idPrefix="duration"
          label="Duration"
          value={value}
          units={units}
          onChange={() => undefined}
        />
        <TemperatureMeasureControl
          idPrefix="temperature"
          label="Temperature"
          value={value}
          units={units}
          onChange={() => undefined}
        />
      </>,
    );
    const duration = screen.getByRole("group", { name: "Duration" });
    expect(within(duration).getByRole("option", { name: /minute/i })).toBeInTheDocument();
    expect(within(duration).queryByRole("option", { name: /gram/i })).toBeNull();
    expect(within(duration).queryByRole("radio", { name: "To taste" })).toBeNull();
    const temperature = screen.getByRole("group", { name: "Temperature" });
    expect(within(temperature).getByRole("option", { name: /celsius/i })).toBeInTheDocument();
    expect(within(temperature).queryByRole("option", { name: /minute/i })).toBeNull();
  });

  it("clears ingredient-specific package metadata when the unit changes", () => {
    const onChange = vi.fn();
    render(
      <IngredientAmountControl
        idPrefix="packaged-measure"
        label="Amount"
        value={{
          mode: "exact",
          exactValue: "2",
          rangeMinimum: "",
          rangeMaximum: "",
          unit: units[3],
          packageSizeId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        }}
        units={units}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Unit" }), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledWith({
      mode: "exact",
      exactValue: "2",
      rangeMinimum: "",
      rangeMaximum: "",
      unit: null,
      packageSizeId: null,
    });
  });
});
