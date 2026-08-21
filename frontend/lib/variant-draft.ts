import type { RecipeDetail } from "./recipe-api";
import type {
  IngredientEdit,
  InstructionEdit,
  RecipeVariantCreateRequest,
} from "./variant-api";

export interface VariantIngredientDraft {
  key: string;
  sourceId: string | null;
  sourceDisplayName: string | null;
  sourceCanonicalName: string | null;
  ingredientName: string;
  quantity: string;
  originalQuantity: string | null;
  unit: string;
  originalUnit: string | null;
  preparationNotes: string;
  removed: boolean;
}

export interface VariantInstructionDraft {
  key: string;
  sourceId: string | null;
  text: string;
  originalText: string | null;
  removed: boolean;
}

export interface RecipeVariantDraft {
  title: string;
  description: string;
  servings: string;
  ingredients: VariantIngredientDraft[];
  instructions: VariantInstructionDraft[];
}

export interface VariantDraftValidation {
  fieldErrors: Record<string, string>;
  formErrors: string[];
  payload: RecipeVariantCreateRequest | null;
}

const TITLE_MAX_LENGTH = 200;
const DESCRIPTION_MAX_LENGTH = 2_000;
const INGREDIENT_NAME_MAX_LENGTH = 200;
const UNIT_MAX_LENGTH = 64;
const PREPARATION_NOTES_MAX_LENGTH = 1_000;
const INSTRUCTION_MAX_LENGTH = 5_000;

function normalized(value: string): string {
  return value.trim();
}

function sameName(left: string, right: string): boolean {
  return normalized(left).toLocaleLowerCase() === normalized(right).toLocaleLowerCase();
}

function initialVariantTitle(sourceTitle: string): string {
  const suffix = " variant";
  const source = normalized(sourceTitle);
  if (source.length + suffix.length <= TITLE_MAX_LENGTH) {
    return `${source}${suffix}`;
  }
  return `${source.slice(0, TITLE_MAX_LENGTH - suffix.length).trimEnd()}${suffix}`;
}

export function createVariantDraft(source: RecipeDetail): RecipeVariantDraft {
  return {
    title: initialVariantTitle(source.title),
    description: source.description ?? "",
    servings: source.servings,
    ingredients: source.ingredients.map((ingredient) => ({
      key: `source-${ingredient.id}`,
      sourceId: ingredient.id,
      sourceDisplayName: ingredient.display_name,
      sourceCanonicalName: ingredient.canonical_name,
      ingredientName: "",
      quantity: ingredient.quantity ?? "",
      originalQuantity: ingredient.quantity,
      unit: ingredient.unit ?? "",
      originalUnit: ingredient.unit,
      preparationNotes: ingredient.preparation_notes ?? "",
      removed: false,
    })),
    instructions: source.instructions.map((instruction) => ({
      key: `source-${instruction.id}`,
      sourceId: instruction.id,
      text: instruction.text,
      originalText: instruction.text,
      removed: false,
    })),
  };
}

export function createAddedIngredientDraft(key: string): VariantIngredientDraft {
  return {
    key,
    sourceId: null,
    sourceDisplayName: null,
    sourceCanonicalName: null,
    ingredientName: "",
    quantity: "",
    originalQuantity: null,
    unit: "",
    originalUnit: null,
    preparationNotes: "",
    removed: false,
  };
}

export function createAddedInstructionDraft(key: string): VariantInstructionDraft {
  return {
    key,
    sourceId: null,
    text: "",
    originalText: null,
    removed: false,
  };
}

export function ingredientFieldKey(
  ingredientKey: string,
  field: "name" | "quantity" | "unit" | "preparationNotes",
): string {
  return `ingredient.${ingredientKey}.${field}`;
}

export function instructionFieldKey(instructionKey: string): string {
  return `instruction.${instructionKey}.text`;
}

function decimalError(
  value: string,
  {
    label,
    maxWholeDigits,
    maxDecimalPlaces,
    required,
  }: {
    label: string;
    maxWholeDigits: number;
    maxDecimalPlaces: number;
    required: boolean;
  },
): string | null {
  const amount = normalized(value);
  if (!amount) {
    return required ? `${label} is required.` : null;
  }
  if (!/^\d+(?:\.\d+)?$/.test(amount)) {
    return `${label} must be a positive decimal number.`;
  }

  const [wholePart, fractionalPart = ""] = amount.split(".");
  const significantWholePart = wholePart.replace(/^0+/, "") || "0";
  if (significantWholePart.length > maxWholeDigits) {
    return `${label} can have at most ${maxWholeDigits} digits before the decimal point.`;
  }
  if (fractionalPart.length > maxDecimalPlaces) {
    return `${label} can have at most ${maxDecimalPlaces} decimal places.`;
  }
  if (![...wholePart, ...fractionalPart].some((digit) => digit !== "0")) {
    return `${label} must be greater than zero.`;
  }
  return null;
}

function textError(
  value: string,
  {
    label,
    maxLength,
    required,
  }: {
    label: string;
    maxLength: number;
    required: boolean;
  },
): string | null {
  const text = normalized(value);
  if (!text) {
    return required ? `${label} is required.` : null;
  }
  if (text.includes("\0")) {
    return `${label} contains an unsupported character.`;
  }
  if (text.length > maxLength) {
    return `${label} must be ${maxLength.toLocaleString()} characters or fewer.`;
  }
  return null;
}

export function validateVariantDraft(draft: RecipeVariantDraft): VariantDraftValidation {
  const fieldErrors: Record<string, string> = {};
  const formErrors: string[] = [];
  const ingredientEdits: IngredientEdit[] = [];
  const instructionEdits: InstructionEdit[] = [];

  const titleError = textError(draft.title, {
    label: "Variant title",
    maxLength: TITLE_MAX_LENGTH,
    required: true,
  });
  if (titleError) {
    fieldErrors.title = titleError;
  }

  const descriptionError = textError(draft.description, {
    label: "Description",
    maxLength: DESCRIPTION_MAX_LENGTH,
    required: false,
  });
  if (descriptionError) {
    fieldErrors.description = descriptionError;
  }

  const servingsError = decimalError(draft.servings, {
    label: "Servings",
    maxWholeDigits: 6,
    maxDecimalPlaces: 2,
    required: true,
  });
  if (servingsError) {
    fieldErrors.servings = servingsError;
  }

  const retainedIngredients = draft.ingredients.filter((ingredient) => !ingredient.removed);
  if (retainedIngredients.length === 0) {
    formErrors.push("Keep or add at least one ingredient.");
  }

  for (const ingredient of draft.ingredients) {
    if (ingredient.removed) {
      if (ingredient.sourceId) {
        ingredientEdits.push({
          op: "remove",
          recipe_ingredient_id: ingredient.sourceId,
        });
      }
      continue;
    }

    const nameRequired = ingredient.sourceId === null;
    const nameError = textError(ingredient.ingredientName, {
      label: nameRequired ? "Ingredient name" : "Replacement ingredient",
      maxLength: INGREDIENT_NAME_MAX_LENGTH,
      required: nameRequired,
    });
    if (nameError) {
      fieldErrors[ingredientFieldKey(ingredient.key, "name")] = nameError;
    }

    const quantityError = decimalError(ingredient.quantity, {
      label: "Quantity",
      maxWholeDigits: 8,
      maxDecimalPlaces: 4,
      required: false,
    });
    if (quantityError) {
      fieldErrors[ingredientFieldKey(ingredient.key, "quantity")] = quantityError;
    }

    const unitError = textError(ingredient.unit, {
      label: "Unit",
      maxLength: UNIT_MAX_LENGTH,
      required: false,
    });
    if (unitError) {
      fieldErrors[ingredientFieldKey(ingredient.key, "unit")] = unitError;
    }

    const ingredientName = normalized(ingredient.ingredientName);
    const quantity = normalized(ingredient.quantity) || null;
    const unit = normalized(ingredient.unit) || null;
    const preparationNotes = normalized(ingredient.preparationNotes) || null;

    if (ingredient.sourceId === null) {
      const notesError = textError(ingredient.preparationNotes, {
        label: "Preparation notes",
        maxLength: PREPARATION_NOTES_MAX_LENGTH,
        required: false,
      });
      if (notesError) {
        fieldErrors[ingredientFieldKey(ingredient.key, "preparationNotes")] = notesError;
      }
      ingredientEdits.push({
        op: "add",
        ingredient_name: ingredientName,
        quantity,
        unit,
        preparation_notes: preparationNotes,
      });
      continue;
    }

    if (
      ingredientName &&
      ((ingredient.sourceDisplayName && sameName(ingredientName, ingredient.sourceDisplayName)) ||
        (ingredient.sourceCanonicalName &&
          sameName(ingredientName, ingredient.sourceCanonicalName)))
    ) {
      fieldErrors[ingredientFieldKey(ingredient.key, "name")] =
        "Choose a different ingredient or leave the replacement blank.";
    } else if (ingredientName) {
      ingredientEdits.push({
        op: "replace",
        recipe_ingredient_id: ingredient.sourceId,
        ingredient_name: ingredientName,
      });
    }

    if (quantity !== ingredient.originalQuantity) {
      ingredientEdits.push({
        op: "set_quantity",
        recipe_ingredient_id: ingredient.sourceId,
        quantity,
      });
    }
    if (unit !== ingredient.originalUnit) {
      ingredientEdits.push({
        op: "set_unit",
        recipe_ingredient_id: ingredient.sourceId,
        unit,
      });
    }
  }

  const retainedInstructions = draft.instructions.filter((instruction) => !instruction.removed);
  if (retainedInstructions.length === 0) {
    formErrors.push("Keep or add at least one instruction.");
  }

  for (const instruction of draft.instructions) {
    if (instruction.removed) {
      if (instruction.sourceId) {
        instructionEdits.push({
          op: "remove",
          recipe_instruction_id: instruction.sourceId,
        });
      }
      continue;
    }

    const text = normalized(instruction.text);
    const changed = instruction.sourceId === null || text !== instruction.originalText;
    if (changed) {
      const instructionError = textError(instruction.text, {
        label: "Instruction",
        maxLength: INSTRUCTION_MAX_LENGTH,
        required: true,
      });
      if (instructionError) {
        fieldErrors[instructionFieldKey(instruction.key)] = instructionError;
      }
    }

    if (instruction.sourceId === null) {
      instructionEdits.push({ op: "add", text });
    } else if (text !== instruction.originalText) {
      instructionEdits.push({
        op: "update",
        recipe_instruction_id: instruction.sourceId,
        text,
      });
    }
  }

  if (Object.keys(fieldErrors).length > 0 || formErrors.length > 0) {
    return { fieldErrors, formErrors, payload: null };
  }

  return {
    fieldErrors,
    formErrors,
    payload: {
      title: normalized(draft.title),
      description: normalized(draft.description) || null,
      servings: normalized(draft.servings),
      ingredient_edits: ingredientEdits,
      instruction_edits: instructionEdits,
    },
  };
}
