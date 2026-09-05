import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RecipeDetail } from "../../lib/recipe-api";
import { deferred } from "../../tests/support/deferred";
import {
  cleanupRecipeDraftEditorMocks,
  detail,
  detailWithBoundCookingAction,
  getRecipeDraftEditorMocks,
  publicSourceRecipe,
  renderEditor,
  resetRecipeDraftEditorMocks,
} from "./recipe-draft-editor-test-support";

const mocks = getRecipeDraftEditorMocks();
afterEach(cleanupRecipeDraftEditorMocks);

describe("RecipeDraftEditor", () => {
  beforeEach(resetRecipeDraftEditorMocks);
  it("offers publication review for an original draft", async () => {
    renderEditor();
    const finish = await screen.findByRole("button", { name: "Finish recipe" });
    expect(finish).toHaveAttribute("aria-haspopup", "dialog");
    expect(
      screen.queryByRole("dialog", {
        name: "Ready to share your recipe?",
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Review and publish" }),
    ).toBeNull();

    fireEvent.click(finish);

    const dialog = await screen.findByRole("dialog", {
      name: "Ready to share your recipe?",
    });
    expect(dialog).toBeVisible();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute(
      "aria-describedby",
      "recipe-workspace-finish-summary",
    );
    expect(document.body).toHaveStyle({ overflow: "hidden" });
    expect(
      within(dialog).getByRole("button", { name: "Review and publish" }),
    ).toBeVisible();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("button", {
          name: "Close publish dialog",
        }),
      ).toHaveFocus(),
    );

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(
      screen.queryByRole("dialog", {
        name: "Ready to share your recipe?",
      }),
    ).toBeNull();
    expect(document.body).not.toHaveStyle({ overflow: "hidden" });
    await waitFor(() => expect(finish).toHaveFocus());
  });

  it("opens the affected cooking breakdown without losing a prose-only saved draft", async () => {
    mocks.fetchRecipeDraft.mockResolvedValue({
      ...detailWithBoundCookingAction,
      instructions: detailWithBoundCookingAction.instructions.map(
        (instruction) => ({
          ...instruction,
          actions: [],
        }),
      ),
    });
    renderEditor();

    const instruction = await screen.findByLabelText("Instruction");
    fireEvent.click(screen.getByRole("button", { name: "Finish recipe" }));
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /right to share this recipe.*community rules/i,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Review and publish" }));

    expect(
      await screen.findByRole("heading", {
        name: "Your draft needs attention",
      }),
    ).toBeVisible();
    expect(instruction).toHaveValue("Stir in the tomato.");
    expect(
      screen.getByText(
        "Add at least one cooking detail to this step so Recipe Lab can compare similar recipes before publishing.",
      ),
    ).toBeVisible();
    expect(screen.getByRole("tab", { name: "Steps" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    ).toHaveAttribute("aria-selected", "true");

    const addDetail = screen.getByRole("button", {
      name: "Add cooking detail to Step 1",
    });
    expect(addDetail).toBeVisible();
    expect(
      screen.queryByRole("dialog", { name: "Cooking detail 1 for Step 1" }),
    ).toBeNull();

    fireEvent.click(addDetail);

    const dialog = screen.getByRole("dialog", {
      name: "Cooking detail 1 for Step 1",
    });
    expect(dialog).toBeVisible();
    await waitFor(() =>
      expect(
        within(dialog).getByRole("combobox", { name: "Cooking action" }),
      ).toHaveFocus(),
    );
  });

  it("focuses an ingredient added immediately after the draft loads", async () => {
    const observer = new MutationObserver(() => {
      const addIngredient = document.getElementById("draft-add-ingredient");
      if (!addIngredient) return;
      observer.disconnect();
      // A native click in this callback reaches the newly committed editor
      // before the loaded draft's passive effects have run.
      addIngredient.click();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    try {
      renderEditor();

      await waitFor(() =>
        expect(
          screen.getByRole("combobox", { name: "Ingredient" }),
        ).toHaveFocus(),
      );
    } finally {
      observer.disconnect();
    }
  });

  it("preserves the public recipe landmarks while exposing blank-recipe editing controls", async () => {
    renderEditor();

    const form = await screen.findByRole("form", {
      name: "Private recipe draft editor",
    });
    expect(form).toHaveClass("draft-editor--authoring");
    const recipe = form.querySelector<HTMLElement>(
      ".recipe-detail.recipe-workspace",
    );
    const header = recipe?.querySelector<HTMLElement>(".recipe-detail__header");
    const hero = header?.querySelector<HTMLElement>(".recipe-detail__hero");
    const artwork = hero?.querySelector<HTMLElement>(".recipe-detail__artwork");
    const intro = hero?.querySelector<HTMLElement>(".recipe-detail__intro");
    const facts = intro?.querySelector<HTMLElement>(".recipe-detail__facts");
    const actions = intro?.querySelector<HTMLElement>(
      ".recipe-detail__member-actions",
    );
    const socialRow = actions?.querySelector<HTMLElement>(
      ".recipe-detail__social-row",
    );
    const actionStrip = actions?.querySelector<HTMLElement>(
      ".recipe-action-strip",
    );
    const tabs = recipe?.querySelector<HTMLElement>(".recipe-detail__tabs");
    const body = tabs?.querySelector<HTMLElement>(".recipe-detail__body");
    const ingredients = body?.querySelector<HTMLElement>(".ingredient-panel");
    const instructions = body?.querySelector<HTMLElement>(".instruction-panel");

    expect(recipe).toBeVisible();
    expect(header).toBeVisible();
    expect(hero).toBeVisible();
    expect(artwork).toBeVisible();
    expect(intro).toBeVisible();
    expect(hero?.firstElementChild).toBe(artwork);
    expect(artwork?.nextElementSibling).toBe(intro);
    expect(facts?.parentElement).toBe(intro);
    expect(actions?.parentElement).toBe(intro);
    expect(within(socialRow!).getByLabelText("No ratings yet")).toBeVisible();
    expect(
      socialRow!.compareDocumentPosition(actionStrip!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      header!.compareDocumentPosition(tabs!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(body).toBeVisible();
    expect(ingredients).toBeVisible();
    expect(instructions).toBeVisible();
    expect(
      ingredients!.compareDocumentPosition(instructions!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(facts!).getByLabelText("Total time")).toBeVisible();
    expect(within(facts!).getByLabelText("Active time")).toBeVisible();
    expect(within(facts!).getByLabelText("Makes")).toBeVisible();
    expect(within(facts!).getByLabelText("Difficulty")).toBeVisible();
    expect(
      screen.getByText("Draft", {
        selector: ".recipe-detail__version-badge",
      }),
    ).toBeVisible();
    expect(screen.queryByText("New private recipe")).toBeNull();
    expect(screen.queryByText("Editing privately")).toBeNull();
    expect(recipe?.querySelector(".recipe-detail__parent-context")).toBeNull();
    expect(screen.getByRole("button", { name: "Finish recipe" })).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Review and publish" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard draft…" })).toBeNull();
    expect(recipe?.querySelector(".recipe-workspace__finish-panel")).toBeNull();
    expect(screen.getByRole("tab", { name: "Recipe" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tab", { name: "Steps" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    ).toHaveAttribute("aria-selected", "false");

    fireEvent.click(screen.getByRole("button", { name: "Add ingredient" }));
    const ingredient = screen.getByRole("group", { name: "Ingredient 1" });
    const ingredientSearch = within(ingredient).getByRole("combobox", {
      name: "Ingredient",
    });
    await waitFor(() => expect(ingredientSearch).toHaveFocus());

    fireEvent.click(screen.getByRole("button", { name: "Add instruction" }));
    const instructionText = screen.getByLabelText("Instruction");
    await waitFor(() => expect(instructionText).toHaveFocus());
    expect(instructionText).toHaveAttribute("rows", "1");

    const instruction = screen.getByRole("group", { name: "Step 1" });
    for (const name of [
      "Move step 1 up",
      "Move step 1 down",
      "Remove step 1",
    ]) {
      expect(within(instruction).getByRole("button", { name })).toHaveClass(
        "recipe-workspace__ingredient-icon",
      );
    }
    expect(screen.getByRole("button", { name: "Add instruction" })).toHaveClass(
      "recipe-workspace__add-row",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Cooking breakdown" }));
    expect(screen.getByRole("tab", { name: "Steps" })).toHaveAttribute(
      "aria-selected",
      "false",
    );
    expect(
      screen.getByRole("tab", { name: "Cooking breakdown" }),
    ).toHaveAttribute("aria-selected", "true");

    const addDetail = screen.getByRole("button", {
      name: "Add cooking detail to Step 1",
    });
    expect(addDetail).toHaveClass("cooking-details__add");
    fireEvent.click(addDetail);

    const detailSummary = screen.getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
    });
    expect(detailSummary).toHaveAttribute("aria-expanded", "true");
    expect(detailSummary).toHaveTextContent("Choose cooking detail");
    const detailDialog = screen.getByRole("dialog", {
      name: "Cooking detail 1 for Step 1",
    });
    expect(detailDialog).toBeVisible();
    await waitFor(() =>
      expect(
        within(detailDialog).getByRole("combobox", { name: "Cooking action" }),
      ).toHaveFocus(),
    );
    expect(
      screen.getByRole("button", { name: "Move cooking detail 1 up" }),
    ).toHaveClass("recipe-workspace__ingredient-icon");
    expect(
      screen.getByRole("button", { name: "Move cooking detail 1 down" }),
    ).toHaveClass("recipe-workspace__ingredient-icon");
    expect(
      screen.getByRole("button", { name: "Remove cooking detail 1" }),
    ).toHaveClass("recipe-workspace__ingredient-icon");

    fireEvent.click(within(detailDialog).getByRole("button", { name: "Done" }));
    expect(
      screen.queryByRole("dialog", { name: "Cooking detail 1 for Step 1" }),
    ).toBeNull();

    fireEvent.click(
      within(ingredient).getByRole("button", {
        name: "Ingredient 1 options",
      }),
    );
    fireEvent.click(
      within(ingredient).getByRole("menuitem", {
        name: "Delete ingredient",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add ingredient" }),
      ).toHaveFocus(),
    );

    fireEvent.click(screen.getByRole("tab", { name: "Steps" }));
    const instructionAfterBreakdown = screen.getByRole("group", {
      name: "Step 1",
    });
    fireEvent.click(
      within(instructionAfterBreakdown).getByRole("button", {
        name: "Remove step 1",
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Add instruction" }),
      ).toHaveFocus(),
    );
  });

  it("warns before removing an ingredient that is linked to a cooking detail", async () => {
    mocks.fetchRecipeDraft.mockResolvedValue(detailWithBoundCookingAction);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderEditor();

    const ingredient = await screen.findByRole("group", {
      name: "Ingredient 1",
    });
    fireEvent.click(screen.getByRole("tab", { name: "Cooking breakdown" }));
    const detailSummary = screen.getByRole("button", {
      name: "Edit cooking detail 1 for Step 1",
    });
    expect(detailSummary).toHaveTextContent("Stir");
    expect(detailSummary).toHaveTextContent("Tomato");
    fireEvent.click(
      within(ingredient).getByRole("button", {
        name: "Ingredient 1 options",
      }),
    );
    const remove = within(ingredient).getByRole("menuitem", {
      name: "Delete ingredient",
    });
    fireEvent.click(remove);

    expect(confirm).toHaveBeenCalledWith(
      "Remove ingredient 1? This will also remove its link from 1 cooking action. The actions and their other details will remain.",
    );
    expect(ingredient).toBeVisible();
    expect(detailSummary).toHaveTextContent("Tomato");

    fireEvent.click(detailSummary);
    expect(
      screen.getByRole("dialog", { name: "Cooking detail 1 for Step 1" }),
    ).toBeVisible();

    confirm.mockReturnValue(true);
    fireEvent.click(
      within(ingredient).getByRole("button", {
        name: "Ingredient 1 options",
      }),
    );
    fireEvent.click(
      within(ingredient).getByRole("menuitem", {
        name: "Delete ingredient",
      }),
    );

    expect(screen.queryByRole("group", { name: "Ingredient 1" })).toBeNull();
    expect(detailSummary).not.toHaveTextContent("Tomato");
  });

  it("offers the persistent publication flow for a source-backed fork draft", async () => {
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const sourceRecipe = publicSourceRecipe(sourceId);
    mocks.fetchRecipeDraft.mockResolvedValue({
      ...detail,
      source_version_id: sourceId,
      title: "My tomato soup",
    });
    renderEditor(undefined, undefined, sourceRecipe);

    expect(
      await screen.findByText("Draft", {
        selector: ".recipe-detail__version-badge",
      }),
    ).toBeVisible();
    expect(screen.queryByText("New private recipe")).toBeNull();
    expect(screen.getByRole("button", { name: "Publish draft" })).toBeVisible();
    expect(
      screen.queryByRole("heading", {
        name: "Ready to share your version?",
      }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Discard draft…" })).toBeNull();
    const sourceLink = screen.getByRole("link", {
      name: "Public tomato soup",
    });
    expect(sourceLink).toHaveAttribute("href", `/recipes/${sourceId}`);
    const parentContext = sourceLink.closest<HTMLElement>(
      ".recipe-detail__parent-context",
    );
    expect(parentContext).not.toBeNull();
    expect(parentContext).toHaveTextContent(
      "Based on Public tomato soup by Source Cook",
    );
    expect(
      within(parentContext!).getByRole("link", { name: "Source Cook" }),
    ).toHaveAttribute("href", "/cooks/source-cook");
    const titleHeading = screen.getByLabelText("Title").closest("h1");
    const descriptionField = screen
      .getByLabelText("Description")
      .closest(".recipe-workspace__description-field");
    expect(
      titleHeading!.compareDocumentPosition(parentContext!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      parentContext!.compareDocumentPosition(descriptionField!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByText("Editing privately")).toBeNull();
    expect(screen.getByRole("link", { name: "Return" })).toHaveAttribute(
      "href",
      `/recipes/${sourceId}`,
    );

    fireEvent.click(screen.getByRole("tab", { name: "Family" }));
    const draftPreview = screen.getByLabelText(
      "Selected current draft: My tomato soup",
    );
    expect(draftPreview).toHaveTextContent("Selected");
    expect(draftPreview).toHaveTextContent("Would become a version");
    expect(within(draftPreview).queryByRole("link")).toBeNull();
    expect(
      screen.queryByText(/will join that recipe family after you publish it/i),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Publish draft" }));

    const dialog = await screen.findByRole("dialog", {
      name: "Ready to share your version?",
    });
    expect(within(dialog).getByText("Publish version")).toBeVisible();
    expect(dialog).toHaveTextContent(
      "Your version will be public, credited to you, and stay linked to the recipe you started from.",
    );
    expect(dialog).toHaveTextContent(
      "Based on Public tomato soup · the source recipe will not change.",
    );
    expect(
      within(dialog).getByRole("button", {
        name: "Review and publish version",
      }),
    ).toBeDisabled();
    expect(
      within(dialog).queryByRole("button", { name: "Discard draft…" }),
    ).toBeNull();
    expect(screen.queryByText(/belongs to RCP-28/i)).toBeNull();
  });

  it("waits for a reopened draft's source name before opening publication", async () => {
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const sourceRecipe = publicSourceRecipe(sourceId, "Resolved source recipe");
    const sourceResponse = deferred<{
      json: () => Promise<RecipeDetail>;
      ok: boolean;
    }>();
    const familyFetch = vi
      .fn()
      .mockImplementationOnce(() => sourceResponse.promise)
      .mockResolvedValueOnce({
        json: async () => ({ items: [] }),
        ok: true,
      });
    vi.stubGlobal("fetch", familyFetch);

    renderEditor({
      ...detail,
      source_version_id: sourceId,
      title: "Reopened private version",
    });

    const publish = screen.getByRole("button", {
      name: "Loading source recipe…",
    });
    expect(publish).toBeDisabled();
    expect(publish).toHaveAttribute("aria-busy", "true");
    const pendingSourceLink = screen.getByRole("link", {
      name: "Source recipe",
    });
    expect(pendingSourceLink).toHaveAttribute("href", `/recipes/${sourceId}`);
    expect(
      pendingSourceLink.closest(".recipe-detail__parent-context"),
    ).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Family" }));
    expect(screen.getByText("Loading recipe family…")).toHaveAttribute(
      "role",
      "status",
    );

    sourceResponse.resolve({
      json: async () => sourceRecipe,
      ok: true,
    });

    await waitFor(() => expect(publish).toBeEnabled());
    expect(publish).toHaveAttribute("aria-busy", "false");
    fireEvent.click(publish);

    const dialog = await screen.findByRole("dialog", {
      name: "Ready to share your version?",
    });
    expect(dialog).toHaveTextContent(
      "Based on Resolved source recipe · the source recipe will not change.",
    );
  });

  it("uses an honest source fallback if a reopened draft's source is unavailable", async () => {
    const sourceId = "22222222-2222-4222-8222-222222222222";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce({ json: async () => ({}), ok: false }),
    );

    renderEditor({
      ...detail,
      source_version_id: sourceId,
      title: "Reopened private version",
    });

    const publish = await screen.findByRole("button", {
      name: "Publish draft",
    });
    expect(publish).toBeEnabled();
    expect(
      screen
        .getByRole("link", { name: "Source recipe unavailable" })
        .closest(".recipe-detail__parent-context"),
    ).not.toBeNull();
    fireEvent.click(publish);

    const dialog = await screen.findByRole("dialog", {
      name: "Ready to share your version?",
    });
    expect(dialog).toHaveTextContent(
      "Based on Source recipe unavailable · the source recipe will not change.",
    );
  });

  it("loads the normal public family tree when a saved version draft is reopened", async () => {
    const sourceId = "22222222-2222-4222-8222-222222222222";
    const sourceRecipe = publicSourceRecipe(sourceId, "Saved source recipe");
    mocks.fetchRecipeDraft.mockResolvedValue({
      ...detail,
      source_version_id: sourceId,
      title: "Resumed private version",
    });
    const familyFetch = vi
      .fn()
      .mockResolvedValueOnce({
        json: async () => sourceRecipe,
        ok: true,
      })
      .mockResolvedValueOnce({
        json: async () => ({ items: [] }),
        ok: true,
      });
    vi.stubGlobal("fetch", familyFetch);

    renderEditor();

    await waitFor(() => expect(familyFetch).toHaveBeenCalledTimes(2));
    const sourceLink = screen
      .getAllByRole("link", { name: "Saved source recipe" })
      .find((link) => link.closest(".recipe-detail__parent-context"));
    expect(sourceLink).toHaveAttribute("href", `/recipes/${sourceId}`);
    expect(familyFetch.mock.calls[0]?.[0]).toBe(`/api/recipes/${sourceId}`);
    expect(familyFetch.mock.calls[1]?.[0]).toContain(
      "/api/recipes?lineage_id=33333333-3333-4333-8333-333333333333",
    );

    fireEvent.click(screen.getByRole("tab", { name: "Family" }));
    expect(
      screen.getByLabelText(
        "Selected current draft: Resumed private version",
      ),
    ).toBeVisible();
    expect(
      screen.queryByText(/will join that recipe family after you publish it/i),
    ).toBeNull();
  });
});
