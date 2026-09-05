import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { CatalogActionType } from "../../lib/cooking-action-api";
import type { RecipeDraftInstructionState } from "../../lib/recipe-draft";
import {
  createStructuredActionDraft,
  type StructuredActionDraft,
} from "../../lib/structured-action";
import { RecipeDraftInstructionsSection } from "./recipe-draft-instructions-section";

const MIX_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";

const actionTypes: CatalogActionType[] = [
  {
    id: MIX_ID,
    key: "mix",
    canonical_verb: "mix",
    active: true,
    provenance: "Test fixture",
  },
];

function instruction(
  key: string,
  title: string,
  text: string,
  actions: StructuredActionDraft[] = [],
): RecipeDraftInstructionState {
  return { key, title, text, actions };
}

function detailedAction(): StructuredActionDraft {
  const action = createStructuredActionDraft("mix-action");
  action.actionType = actionTypes[0] ?? null;
  action.duration = {
    enabled: true,
    value: {
      mode: "exact",
      exactValue: "05.000",
      rangeMinimum: "",
      rangeMaximum: "",
      unit: {
        id: "minute-unit",
        key: "minute",
        dimension: "time",
        canonical_label: "minute",
        plural_label: "minutes",
        symbol: "min",
        display_style: "word",
        active: true,
      },
      packageSizeId: null,
    },
  };
  return action;
}

function Harness({
  disabled = false,
  initialInstructions = [
    instruction("step-one", "Prepare the pan", "Grease the pan."),
    instruction(
      "step-two",
      "Mix the batter",
      "Stir the dry ingredients into the wet ingredients until smooth.",
    ),
  ],
}: {
  disabled?: boolean;
  initialInstructions?: RecipeDraftInstructionState[];
}) {
  const [instructions, setInstructions] = useState(initialInstructions);
  return (
    <RecipeDraftInstructionsSection
      actionTypes={actionTypes}
      disabled={disabled}
      errors={{}}
      ingredientOptions={[]}
      instructions={instructions}
      measurementUnits={[]}
      onActionsChange={(key, actions) =>
        setInstructions((current) =>
          current.map((item) =>
            item.key === key ? { ...item, actions } : item,
          ),
        )
      }
      onAdd={() =>
        setInstructions((current) => [
          ...current,
          instruction(`step-${current.length + 1}`, "", ""),
        ])
      }
      onMove={(index, direction) =>
        setInstructions((current) => {
          const next = [...current];
          const [moved] = next.splice(index, 1);
          if (!moved) return current;
          next.splice(index + direction, 0, moved);
          return next;
        })
      }
      onRemove={(index) =>
        setInstructions((current) =>
          current.filter((_, candidateIndex) => candidateIndex !== index),
        )
      }
      onTextChange={(key, text) =>
        setInstructions((current) =>
          current.map((item) => (item.key === key ? { ...item, text } : item)),
        )
      }
      onTitleChange={(key, title) =>
        setInstructions((current) =>
          current.map((item) =>
            item.key === key ? { ...item, title } : item,
          ),
        )
      }
    />
  );
}

describe("RecipeDraftInstructionsSection", () => {
  it("keeps each title and matching icon controls in one compact header", () => {
    render(<Harness />);

    expect(screen.queryByText("2 steps", { exact: true })).toBeNull();
    const first = screen.getByRole("group", { name: "Step 1" });
    const heading = first.querySelector<HTMLElement>(
      ".recipe-workspace__instruction-heading",
    );
    expect(heading).not.toBeNull();
    const title = within(heading!).getByLabelText("Step title");
    expect(title).toHaveValue("Prepare the pan");
    expect(title).toHaveClass("recipe-workspace__editable-text");
    expect(
      within(heading!).getByRole("button", { name: "Move step 1 up" }),
    ).toBeDisabled();
    expect(
      within(heading!).getByRole("button", { name: "Move step 1 down" }),
    ).toBeVisible();
    expect(
      within(heading!).getByRole("button", { name: "Remove step 1" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Move step 2 down" }),
    ).toBeDisabled();
  });

  it("uses a borderless, content-height instruction textarea", () => {
    render(<Harness />);

    const prose = screen.getAllByLabelText("Instruction")[1];
    expect(prose).toHaveAttribute("rows", "1");
    expect(prose).toHaveValue(
      "Stir the dry ingredients into the wet ingredients until smooth.",
    );
    expect(prose).toHaveClass("recipe-workspace__editable-text");
    expect(prose?.closest(".draft-editor__instruction-field")).not.toBeNull();
  });

  it("shows cooking-detail pills directly beneath the editable step text", () => {
    render(
      <Harness
        initialInstructions={[
          instruction("step-one", "Mix the batter", "Stir until smooth.", [
            detailedAction(),
          ]),
        ]}
      />,
    );

    const prose = screen.getByLabelText("Instruction");
    const proseField = prose.closest(".draft-editor__instruction-field");
    const facts = screen.getByRole("list", {
      name: "Cooking details for step 1",
    });
    expect(facts).toHaveTextContent("Mix · 5 minutes");
    expect(proseField?.nextElementSibling).toBe(facts);
  });

  it("centers the text-only add instruction control below the steps", () => {
    render(<Harness />);

    const add = screen.getByRole("button", { name: "Add instruction" });
    expect(add).toHaveAttribute("aria-label", "Add instruction");
    expect(add).toHaveClass("recipe-workspace__add-row");
    expect(add).not.toHaveClass("button");
    fireEvent.click(add);
    expect(screen.getByRole("group", { name: "Step 3" })).toBeVisible();
  });

  it("adds curated cooking details only from the cooking breakdown", async () => {
    const { container } = render(<Harness />);

    expect(screen.getByRole("tab", { name: "Steps" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.queryByRole("button", { name: "Add cooking detail to Step 1" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "Cooking breakdown" }));
    const breakdownSteps = container.querySelectorAll(
      "#draft-instructions-breakdown-panel > .recipe-workspace__breakdown-list > .recipe-workspace__breakdown-step",
    );
    expect(breakdownSteps).toHaveLength(2);
    breakdownSteps.forEach((step) =>
      expect(step).toHaveClass("recipe-instructions__breakdown-step"),
    );
    const addDetail = screen.getByRole("button", {
      name: "Add cooking detail to Step 1",
    });
    fireEvent.click(addDetail);

    const dialog = await screen.findByRole("dialog", {
      name: "Cooking detail 1 for Step 1",
    });
    const action = within(dialog).getByRole("combobox", {
      name: "Cooking action",
    });
    expect(within(action).getByRole("option", { name: "mix" })).toBeVisible();
    await waitFor(() => expect(action).toHaveFocus());
  });

  it("moves and removes steps through the compact icon controls", () => {
    render(<Harness />);

    fireEvent.click(screen.getByRole("button", { name: "Move step 1 down" }));
    expect(screen.getAllByLabelText("Step title")[0]).toHaveValue(
      "Mix the batter",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove step 1" }));
    expect(screen.getAllByLabelText("Step title")).toHaveLength(1);
  });

  it("disables step and cooking-breakdown controls together", () => {
    render(<Harness disabled />);

    expect(screen.getAllByLabelText("Step title")[0]).toBeDisabled();
    expect(screen.getAllByLabelText("Instruction")[0]).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Remove step 1" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Add instruction" }),
    ).toBeDisabled();
  });
});
