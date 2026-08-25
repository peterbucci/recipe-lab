import { describe, expect, it } from "vitest";

import type { CatalogUnit } from "./measurement-unit-api";
import {
  compareDecimalStrings,
  createStructuredMeasureDraft,
  durationPolicy,
  formatStructuredMeasureDraft,
  ingredientAmountPolicy,
  recipeMeasureInput,
  structuredMeasureDraftMatchesRecipe,
  temperaturePolicy,
  validateStructuredMeasureDraft,
  type StructuredMeasureDraft,
} from "./structured-measure";

const gram: CatalogUnit = {
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
};
const minute: CatalogUnit = {
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
};
const celsius: CatalogUnit = {
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
};
const can: CatalogUnit = {
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
};
const cup: CatalogUnit = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  key: "cup",
  dimension: "volume",
  canonical_label: "cup",
  plural_label: "cups",
  symbol: "cup",
  display_style: "word",
  aliases: ["cups"],
  active: true,
  provenance: "Test fixture",
};

const PACKAGE_SIZE_ID = "ffffffff-ffff-4fff-8fff-fffffffffff1";
const OTHER_PACKAGE_SIZE_ID = "ffffffff-ffff-4fff-8fff-fffffffffff2";

function exactDraft(value = "1.5", unit = gram): StructuredMeasureDraft {
  return {
    mode: "exact",
    exactValue: value,
    rangeMinimum: "",
    rangeMaximum: "",
    unit,
    packageSizeId: null,
  };
}

describe("structured measure domain", () => {
  it("hydrates persisted decimals as human-friendly editor values", () => {
    expect(
      createStructuredMeasureDraft({
        kind: "range",
        minimum: "1.0000",
        maximum: "2.5000",
        unit: gram,
        package_size_id: PACKAGE_SIZE_ID,
        display_unit: "g",
        display: "1–2.5 g",
      }),
    ).toEqual({
      mode: "range",
      exactValue: "",
      rangeMinimum: "1",
      rangeMaximum: "2.5",
      unit: gram,
      packageSizeId: PACKAGE_SIZE_ID,
    });
    expect(
      createStructuredMeasureDraft({
        kind: "exact",
        value: "2.0000",
        unit: gram,
        package_size_id: null,
        display_unit: "g",
        display: "2 g",
      }).exactValue,
    ).toBe("2");
  });

  it("preserves package-size identity in exact and range payloads", () => {
    expect(
      validateStructuredMeasureDraft(
        { ...exactDraft("2", can), packageSizeId: PACKAGE_SIZE_ID },
        ingredientAmountPolicy,
        [can],
      ),
    ).toEqual({
      fieldErrors: {},
      measure: {
        kind: "exact",
        value: "2",
        unit_id: can.id,
        package_size_id: PACKAGE_SIZE_ID,
      },
    });

    const rangeDraft: StructuredMeasureDraft = {
      ...exactDraft("", can),
      mode: "range",
      rangeMinimum: "1",
      rangeMaximum: "3",
      packageSizeId: PACKAGE_SIZE_ID,
    };
    expect(
      validateStructuredMeasureDraft(rangeDraft, ingredientAmountPolicy, [can]),
    ).toEqual({
      fieldErrors: {},
      measure: {
        kind: "range",
        minimum: "1",
        maximum: "3",
        unit_id: can.id,
        package_size_id: PACKAGE_SIZE_ID,
      },
    });
    expect(
      recipeMeasureInput({
        kind: "range",
        minimum: "1.0000",
        maximum: "3.0000",
        unit: can,
        package_size_id: PACKAGE_SIZE_ID,
        display_unit: "cans",
        display: "1–3 cans",
      }),
    ).toEqual({
      kind: "range",
      minimum: "1.0000",
      maximum: "3.0000",
      unit_id: can.id,
      package_size_id: PACKAGE_SIZE_ID,
    });
  });

  it("treats a package-size identity change as a structured-measure change", () => {
    const exactOriginal = {
      kind: "exact" as const,
      value: "2.0000",
      unit: can,
      package_size_id: PACKAGE_SIZE_ID,
      display_unit: "cans",
      display: "2 cans",
    };
    expect(
      structuredMeasureDraftMatchesRecipe(
        { ...exactDraft("2", can), packageSizeId: PACKAGE_SIZE_ID },
        exactOriginal,
      ),
    ).toBe(true);
    expect(
      structuredMeasureDraftMatchesRecipe(
        { ...exactDraft("2", can), packageSizeId: OTHER_PACKAGE_SIZE_ID },
        exactOriginal,
      ),
    ).toBe(false);

    const rangeOriginal = {
      kind: "range" as const,
      minimum: "1.0000",
      maximum: "3.0000",
      unit: can,
      package_size_id: PACKAGE_SIZE_ID,
      display_unit: "cans",
      display: "1–3 cans",
    };
    const rangeDraft: StructuredMeasureDraft = {
      ...exactDraft("", can),
      mode: "range",
      rangeMinimum: "1",
      rangeMaximum: "3",
      packageSizeId: PACKAGE_SIZE_ID,
    };
    expect(structuredMeasureDraftMatchesRecipe(rangeDraft, rangeOriginal)).toBe(true);
    expect(
      structuredMeasureDraftMatchesRecipe(
        { ...rangeDraft, packageSizeId: OTHER_PACKAGE_SIZE_ID },
        rangeOriginal,
      ),
    ).toBe(false);
  });

  it("serializes exact, range, and qualitative values without numeric conversion", () => {
    expect(
      validateStructuredMeasureDraft(exactDraft(" 001.2500 "), ingredientAmountPolicy, [gram]),
    ).toEqual({
      fieldErrors: {},
      measure: { kind: "exact", value: "001.2500", unit_id: gram.id },
    });
    expect(
      validateStructuredMeasureDraft(
        {
          ...exactDraft(),
          mode: "range",
          rangeMinimum: "0.25",
          rangeMaximum: "2.0000",
        },
        ingredientAmountPolicy,
        [gram],
      ),
    ).toEqual({
      fieldErrors: {},
      measure: {
        kind: "range",
        minimum: "0.25",
        maximum: "2.0000",
        unit_id: gram.id,
      },
    });
    expect(
      validateStructuredMeasureDraft(
        { ...exactDraft(), mode: "to_taste" },
        ingredientAmountPolicy,
        [gram],
      ),
    ).toEqual({
      fieldErrors: {},
      measure: { kind: "qualitative", value: "to_taste" },
    });
    expect(
      validateStructuredMeasureDraft(exactDraft("2", can), ingredientAmountPolicy, [can]),
    ).toMatchObject({ fieldErrors: {}, measure: { unit_id: can.id } });
  });

  it("compares decimal strings exactly and validates semantic numeric rules", () => {
    expect(compareDecimalStrings("9007199254740992.0001", "9007199254740992.0000")).toBe(1);
    expect(compareDecimalStrings("-20.5", "-3")).toBe(-1);
    expect(compareDecimalStrings("-0.000", "0")).toBe(0);

    expect(
      validateStructuredMeasureDraft(exactDraft("0"), ingredientAmountPolicy, [gram]),
    ).toMatchObject({ fieldErrors: { amount: "Amount must be greater than zero." } });
    expect(
      validateStructuredMeasureDraft(exactDraft("-5", celsius), temperaturePolicy, [celsius]),
    ).toMatchObject({
      fieldErrors: {},
      measure: { kind: "exact", value: "-5", unit_id: celsius.id },
    });
    expect(
      validateStructuredMeasureDraft(
        exactDraft("-5.123456", celsius),
        temperaturePolicy,
        [celsius],
      ),
    ).toMatchObject({ fieldErrors: {}, measure: { value: "-5.123456" } });
    expect(
      validateStructuredMeasureDraft(
        exactDraft("-5.1234567", celsius),
        temperaturePolicy,
        [celsius],
      ),
    ).toMatchObject({
      measure: null,
      fieldErrors: { amount: "Temperature can have at most 6 decimal places." },
    });
    expect(
      validateStructuredMeasureDraft(exactDraft("5", minute), durationPolicy, [minute]),
    ).toMatchObject({ fieldErrors: {}, measure: { unit_id: minute.id } });
    expect(durationPolicy.semantic).toBe("action_duration");
  });

  it("rejects non-increasing ranges, incompatible units, and inactive units", () => {
    const range = {
      ...exactDraft(),
      mode: "range" as const,
      rangeMinimum: "2.00",
      rangeMaximum: "2.0000",
    };
    expect(
      validateStructuredMeasureDraft(range, ingredientAmountPolicy, [gram]),
    ).toMatchObject({
      measure: null,
      fieldErrors: { maximum: "Maximum must be greater than minimum." },
    });
    expect(
      validateStructuredMeasureDraft(exactDraft("2", minute), ingredientAmountPolicy, [minute]),
    ).toMatchObject({
      measure: null,
      fieldErrors: { unit: "Choose an active compatible unit." },
    });
    expect(
      validateStructuredMeasureDraft(
        exactDraft("2", { ...gram, active: false }),
        ingredientAmountPolicy,
        [],
      ),
    ).toMatchObject({
      measure: null,
      fieldErrors: { unit: "Choose an active compatible unit." },
    });
  });

  it("does not mutate raw values and formats draft summaries naturally", () => {
    const draft = {
      ...exactDraft("3.0000"),
      rangeMinimum: "1.0000",
      rangeMaximum: "2.5000",
    };
    const before = structuredClone(draft);
    validateStructuredMeasureDraft(draft, ingredientAmountPolicy, [gram]);
    expect(draft).toEqual(before);
    expect(formatStructuredMeasureDraft(draft)).toBe("3 g");
    expect(formatStructuredMeasureDraft({ ...draft, mode: "range" })).toBe("1–2.5 g");
    expect(
      formatStructuredMeasureDraft({
        ...draft,
        mode: "range",
        rangeMinimum: "0.5",
        rangeMaximum: "1.0000",
        unit: can,
      }),
    ).toBe("0.5–1 can");
    expect(
      formatStructuredMeasureDraft({
        ...draft,
        mode: "range",
        rangeMinimum: "1",
        rangeMaximum: "2",
        unit: can,
      }),
    ).toBe("1–2 cans");
    expect(
      formatStructuredMeasureDraft({
        ...draft,
        mode: "range",
        rangeMinimum: "0.5",
        rangeMaximum: "1",
        unit: cup,
      }),
    ).toBe("0.5–1 cup");
    expect(
      formatStructuredMeasureDraft({
        ...draft,
        mode: "range",
        rangeMinimum: "1",
        rangeMaximum: "2",
        unit: cup,
      }),
    ).toBe("1–2 cups");
    expect(formatStructuredMeasureDraft(exactDraft("2", minute))).toBe("2 minutes");
    expect(formatStructuredMeasureDraft({ ...draft, mode: "as_needed" })).toBe("As needed");
    expect(
      formatStructuredMeasureDraft({ ...draft, unit: { ...gram, active: false } }),
    ).toBe("3 g (unavailable unit)");
    expect(
      structuredMeasureDraftMatchesRecipe(draft, {
        kind: "exact",
        value: "3.0000",
        unit: gram,
        display_unit: "g",
        display: "3 g",
      }),
    ).toBe(true);
    expect(
      structuredMeasureDraftMatchesRecipe(
        { ...draft, exactValue: "3" },
        {
          kind: "exact",
          value: "3.0000",
          unit: gram,
          display_unit: "g",
          display: "3 g",
        },
      ),
    ).toBe(true);
  });
});
