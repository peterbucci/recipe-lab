import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeDetail } from "../../lib/recipe-api";
import { createRecipeVariant, VariantApiError } from "../../lib/variant-api";
import { RecipeVariantEditor } from "./recipe-variant-editor";

const mocks = vi.hoisted(() => ({
  createIdempotencyKey: vi.fn(),
  createRecipeVariant: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("../../lib/variant-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/variant-api")>();
  return {
    ...actual,
    createRecipeVariant: mocks.createRecipeVariant,
  };
});

vi.mock("../../lib/idempotency-key", () => ({
  createIdempotencyKey: mocks.createIdempotencyKey,
}));

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const CHILD_ID = "22222222-2222-4222-8222-222222222222";
const FIRST_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const SECOND_KEY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

function sourceRecipe(overrides: Partial<RecipeDetail> = {}): RecipeDetail {
  return {
    id: SOURCE_ID,
    lineage_id: "33333333-3333-4333-8333-333333333333",
    parent_version_id: null,
    version_number: 1,
    title: "Carrot Walnut Snack Cake",
    description: "A softly spiced snack cake.",
    servings: "8.00",
    created_at: "2026-08-20T00:00:00Z",
    average_rating: 4.5,
    rating_count: 2,
    viewer_state: {
      recipe_version_id: SOURCE_ID,
      user: {
        id: "44444444-4444-4444-8444-444444444444",
        display_name: "Demo Cook",
        identity_mode: "shared_demo",
      },
      saved: false,
      rating: null,
    },
    parent: null,
    children: [],
    ingredients: [
      {
        id: "sugar-row",
        ingredient_id: "sugar",
        canonical_name: "Granulated sugar",
        display_name: "White sugar",
        quantity: "180.0000",
        unit: "g",
        preparation_notes: null,
        display_order: 0,
      },
      {
        id: "walnut-row",
        ingredient_id: "walnut",
        canonical_name: "Walnut",
        display_name: "Walnuts",
        quantity: "100.0000",
        unit: "g",
        preparation_notes: "roughly chopped",
        display_order: 1,
      },
      {
        id: "salt-row",
        ingredient_id: "salt",
        canonical_name: "Salt",
        display_name: "Salt",
        quantity: null,
        unit: null,
        preparation_notes: null,
        display_order: 2,
      },
    ],
    instructions: [
      { id: "mix-step", text: "Whisk the dry ingredients.", display_order: 0 },
      { id: "fold-step", text: "Fold in the carrots and walnuts.", display_order: 1 },
      { id: "bake-step", text: "Bake until springy.", display_order: 2 },
    ],
    ...overrides,
  };
}

function createdRecipe(): RecipeDetail {
  return {
    ...sourceRecipe(),
    id: CHILD_ID,
    parent_version_id: SOURCE_ID,
    version_number: 2,
    title: "Orange Pecan Carrot Cake",
    viewer_state: {
      ...sourceRecipe().viewer_state,
      recipe_version_id: CHILD_ID,
    },
    parent: {
      id: SOURCE_ID,
      version_number: 1,
      title: "Carrot Walnut Snack Cake",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  mocks.replace.mockReset();
  mocks.createRecipeVariant.mockReset();
  mocks.createIdempotencyKey.mockReset();
  mocks.createIdempotencyKey
    .mockReturnValueOnce(FIRST_KEY)
    .mockReturnValueOnce(SECOND_KEY);
});

describe("RecipeVariantEditor", () => {
  it("prefills an accessible editable copy, including nullable amounts and units", () => {
    render(<RecipeVariantEditor sourceRecipe={sourceRecipe()} />);

    const form = screen.getByRole("form", {
      name: /create a child variant from carrot walnut snack cake/i,
    });
    expect(within(form).getByRole("group", { name: /variant details/i })).toBeInTheDocument();
    expect(within(form).getByRole("group", { name: /^ingredients$/i })).toBeInTheDocument();
    expect(within(form).getByRole("group", { name: /^instructions$/i })).toBeInTheDocument();
    expect(within(form).getByLabelText(/^title$/i)).toHaveValue(
      "Carrot Walnut Snack Cake variant",
    );
    expect(within(form).getByLabelText(/^description$/i)).toHaveValue(
      "A softly spiced snack cake.",
    );
    expect(within(form).getByLabelText(/^servings$/i)).toHaveValue("8.00");
    expect(within(form).getByLabelText(/^servings$/i)).toHaveAttribute(
      "inputmode",
      "decimal",
    );

    const sugar = within(form).getByRole("group", {
      name: "Ingredient 1: White sugar",
    });
    expect(within(sugar).getByText("White sugar")).toBeInTheDocument();
    expect(within(sugar).getByText(/catalog name: granulated sugar/i)).toBeInTheDocument();
    expect(within(sugar).getByLabelText(/replacement ingredient/i)).toHaveValue("");
    expect(within(sugar).getByLabelText(/^quantity$/i)).toHaveValue("180.0000");
    expect(within(sugar).getByLabelText(/^quantity$/i)).toHaveAttribute(
      "inputmode",
      "decimal",
    );
    expect(within(sugar).getByLabelText(/^unit$/i)).toHaveValue("g");

    const salt = within(form).getByRole("group", { name: /ingredient 3/i });
    expect(within(salt).getByLabelText(/^quantity$/i)).toHaveValue("");
    expect(within(salt).getByLabelText(/^unit$/i)).toHaveValue("");
    expect(within(form).getByLabelText(/^step 1$/i)).toHaveValue(
      "Whisk the dry ingredients.",
    );
    expect(within(form).getByRole("link", { name: /^cancel$/i })).toHaveAttribute(
      "href",
      `/recipes/${SOURCE_ID}`,
    );
  });

  it("moves focus into added rows and preserves it across remove and undo", () => {
    render(<RecipeVariantEditor sourceRecipe={sourceRecipe()} />);

    fireEvent.click(screen.getByRole("button", { name: /add ingredient/i }));
    const addedIngredient = screen.getByRole("group", {
      name: "New ingredient 4",
    });
    expect(within(addedIngredient).getByLabelText(/ingredient name/i)).toHaveFocus();

    fireEvent.click(
      within(addedIngredient).getByRole("button", { name: /remove new ingredient 4/i }),
    );
    const undoIngredient = within(addedIngredient).getByRole("button", {
      name: /undo removal of new ingredient 4/i,
    });
    expect(undoIngredient).toHaveFocus();
    fireEvent.click(undoIngredient);
    expect(
      within(addedIngredient).getByRole("button", { name: /remove new ingredient 4/i }),
    ).toHaveFocus();

    fireEvent.click(screen.getByRole("button", { name: /add instruction/i }));
    const newStep = screen.getByLabelText("Step 4", { exact: true });
    expect(newStep).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /remove step 4/i }));
    const undoStep = screen.getByRole("button", {
      name: /undo removal of step 4/i,
    });
    expect(undoStep).toHaveFocus();
    fireEvent.click(undoStep);
    expect(screen.getByRole("button", { name: /remove step 4/i })).toHaveFocus();
  });

  it("submits the exact mixed edit payload after add, remove, and undo interactions", async () => {
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    render(<RecipeVariantEditor sourceRecipe={sourceRecipe()} />);

    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "  Orange Pecan Carrot Cake  " },
    });
    fireEvent.change(screen.getByLabelText(/^description$/i), {
      target: { value: "   " },
    });

    const sugar = screen.getByRole("group", { name: /ingredient 1/i });
    fireEvent.change(within(sugar).getByLabelText(/^quantity$/i), {
      target: { value: "140.0000" },
    });
    fireEvent.change(within(sugar).getByLabelText(/^unit$/i), {
      target: { value: "cup" },
    });

    const walnuts = screen.getByRole("group", { name: /ingredient 2/i });
    fireEvent.change(within(walnuts).getByLabelText(/replacement ingredient/i), {
      target: { value: "  Pecan  " },
    });

    const salt = screen.getByRole("group", { name: /ingredient 3/i });
    fireEvent.click(within(salt).getByRole("button", { name: /remove salt/i }));
    expect(
      within(salt).getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent === "Salt will be removed from the child variant.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(within(salt).getByRole("button", { name: /undo removal/i }));
    expect(within(salt).getByLabelText(/^quantity$/i)).toHaveValue("");
    expect(within(salt).getByLabelText(/^unit$/i)).toHaveValue("");
    fireEvent.click(within(salt).getByRole("button", { name: /remove salt/i }));

    fireEvent.click(screen.getByRole("button", { name: /add ingredient/i }));
    const addedIngredient = screen.getByRole("group", { name: /ingredient 4/i });
    fireEvent.change(within(addedIngredient).getByLabelText(/ingredient name/i), {
      target: { value: "  Orange zest  " },
    });
    fireEvent.change(within(addedIngredient).getByLabelText(/^quantity$/i), {
      target: { value: " 1.25 " },
    });
    fireEvent.change(within(addedIngredient).getByLabelText(/^unit$/i), {
      target: { value: " tbsp " },
    });
    fireEvent.change(within(addedIngredient).getByLabelText(/preparation notes/i), {
      target: { value: " finely grated " },
    });

    fireEvent.change(screen.getByLabelText(/^step 1$/i), {
      target: { value: "  Whisk the dry ingredients thoroughly.  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /remove step 2/i }));
    fireEvent.click(screen.getByRole("button", { name: /add instruction/i }));
    fireEvent.change(screen.getByLabelText(/^step 4$/i), {
      target: { value: "  Cool completely before serving.  " },
    });

    fireEvent.click(screen.getByRole("button", { name: /^create variant$/i }));

    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledOnce());
    expect(createRecipeVariant).toHaveBeenCalledWith(
      SOURCE_ID,
      {
        title: "Orange Pecan Carrot Cake",
        description: null,
        servings: "8.00",
        ingredient_edits: [
          {
            op: "set_quantity",
            recipe_ingredient_id: "sugar-row",
            quantity: "140.0000",
          },
          {
            op: "set_unit",
            recipe_ingredient_id: "sugar-row",
            unit: "cup",
          },
          {
            op: "replace",
            recipe_ingredient_id: "walnut-row",
            ingredient_name: "Pecan",
          },
          { op: "remove", recipe_ingredient_id: "salt-row" },
          {
            op: "add",
            ingredient_name: "Orange zest",
            quantity: "1.25",
            unit: "tbsp",
            preparation_notes: "finely grated",
          },
        ],
        instruction_edits: [
          {
            op: "update",
            recipe_instruction_id: "mix-step",
            text: "Whisk the dry ingredients thoroughly.",
          },
          { op: "remove", recipe_instruction_id: "fold-step" },
          { op: "add", text: "Cool completely before serving." },
        ],
      },
      FIRST_KEY,
    );
  });

  it("reports local validation errors without posting or clearing entered values", async () => {
    render(<RecipeVariantEditor sourceRecipe={sourceRecipe()} />);

    const title = screen.getByLabelText(/^title$/i);
    const servings = screen.getByLabelText(/^servings$/i);
    const sugarQuantity = within(
      screen.getByRole("group", { name: /ingredient 1/i }),
    ).getByLabelText(/^quantity$/i);
    const firstStep = screen.getByLabelText(/^step 1$/i);

    fireEvent.change(title, { target: { value: "   " } });
    fireEvent.change(servings, { target: { value: "0.00" } });
    fireEvent.change(sugarQuantity, { target: { value: "1.00001" } });
    fireEvent.change(firstStep, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /^create variant$/i }));

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Variant title is required.")).toBeInTheDocument();
    expect(within(alert).getByText("Servings must be greater than zero.")).toBeInTheDocument();
    expect(
      within(alert).getByText("Quantity can have at most 4 decimal places."),
    ).toBeInTheDocument();
    expect(within(alert).getByText("Instruction is required.")).toBeInTheDocument();
    expect(createRecipeVariant).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();

    expect(title).toHaveValue("   ");
    expect(servings).toHaveValue("0.00");
    expect(sugarQuantity).toHaveValue("1.00001");
    expect(firstStep).toHaveValue("   ");
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(servings).toHaveAttribute("aria-invalid", "true");
    expect(sugarQuantity).toHaveAttribute("aria-invalid", "true");
    expect(firstStep).toHaveAttribute("aria-invalid", "true");
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("preserves the draft and stays on the editor after a backend 422", async () => {
    vi.mocked(createRecipeVariant).mockRejectedValue(
      new VariantApiError(
        'Ingredient "Dragon fruit" is not in the catalog.',
        422,
        "invalid_recipe_edits",
      ),
    );
    render(<RecipeVariantEditor sourceRecipe={sourceRecipe()} />);

    const title = screen.getByLabelText(/^title$/i);
    const replacement = within(
      screen.getByRole("group", { name: /ingredient 2/i }),
    ).getByLabelText(/replacement ingredient/i);
    fireEvent.change(title, { target: { value: "Tropical carrot cake" } });
    fireEvent.change(replacement, { target: { value: "Dragon fruit" } });
    fireEvent.click(screen.getByRole("button", { name: /^create variant$/i }));

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText('Ingredient "Dragon fruit" is not in the catalog.'),
    ).toBeInTheDocument();
    expect(title).toHaveValue("Tropical carrot cake");
    expect(replacement).toHaveValue("Dragon fruit");
    expect(screen.getByRole("form")).toHaveAttribute("aria-busy", "false");
    expect(screen.getByRole("button", { name: /^create variant$/i })).toBeEnabled();
    expect(createRecipeVariant).toHaveBeenCalledOnce();
    expect(mocks.replace).not.toHaveBeenCalled();
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it("reuses a failed fork key until the draft changes", async () => {
    vi.mocked(createRecipeVariant)
      .mockRejectedValueOnce(new Error("response lost"))
      .mockRejectedValueOnce(new Error("response lost"))
      .mockResolvedValueOnce(createdRecipe());
    render(<RecipeVariantEditor sourceRecipe={sourceRecipe()} />);

    const createButton = screen.getByRole("button", { name: /^create variant$/i });
    fireEvent.click(createButton);
    await screen.findByRole("alert");
    fireEvent.click(createButton);
    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledTimes(2));
    await screen.findByRole("alert");

    fireEvent.change(screen.getByLabelText(/^title$/i), {
      target: { value: "A revised carrot cake variant" },
    });
    fireEvent.click(createButton);

    await waitFor(() => expect(createRecipeVariant).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(createRecipeVariant).mock.calls;
    expect(calls[0]?.[2]).toBe(FIRST_KEY);
    expect(calls[1]?.[2]).toBe(FIRST_KEY);
    expect(calls[2]?.[2]).toBe(SECOND_KEY);
    expect(mocks.createIdempotencyKey).toHaveBeenCalledTimes(2);
  });

  it("guards against same-tick duplicate submissions while creation is pending", async () => {
    const request = deferred<RecipeDetail>();
    vi.mocked(createRecipeVariant).mockReturnValue(request.promise);
    render(<RecipeVariantEditor sourceRecipe={sourceRecipe()} />);

    const form = screen.getByRole("form");
    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(createRecipeVariant).toHaveBeenCalledOnce();
    expect(form).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: /creating variant/i })).toBeDisabled();
    expect(screen.getByText(/creating your child variant/i)).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByText(/^cancel$/i)).toHaveAttribute("aria-disabled", "true");

    await act(async () => {
      request.resolve(createdRecipe());
      await request.promise;
    });
    expect(mocks.replace).toHaveBeenCalledWith(`/recipes/${CHILD_ID}`);
  });

  it("replaces the editor route with the newly created child recipe", async () => {
    vi.mocked(createRecipeVariant).mockResolvedValue(createdRecipe());
    render(<RecipeVariantEditor sourceRecipe={sourceRecipe()} />);

    fireEvent.click(screen.getByRole("button", { name: /^create variant$/i }));

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledOnce();
      expect(mocks.replace).toHaveBeenCalledWith(`/recipes/${CHILD_ID}`);
    });
    expect(screen.getByRole("form")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Variant created. Opening the new recipe…",
    );
  });
});
