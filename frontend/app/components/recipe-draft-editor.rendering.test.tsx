import { render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NavigationBlockerProvider } from "./navigation-blocker-provider";
import {
  cleanupRecipeDraftEditorMocks,
  detail,
  DRAFT_ID,
  getRecipeDraftEditorMocks,
  publicSourceRecipe,
  renderEditor,
  resetRecipeDraftEditorMocks,
} from "./recipe-draft-editor-test-support";
import { RecipeDraftLoadingView } from "./recipe-draft-editor";

const mocks = getRecipeDraftEditorMocks();
afterEach(cleanupRecipeDraftEditorMocks);

describe("RecipeDraftEditor", () => {
  beforeEach(resetRecipeDraftEditorMocks);
  it("renders a prepared draft immediately without showing the editor loading screen", () => {
    renderEditor({
      ...detail,
      title: "Prepared tomato soup",
      source_version_id: "99999999-9999-4999-8999-999999999999",
    });

    expect(
      screen.getByRole("form", { name: "Private recipe draft editor" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Title")).toHaveValue("Prepared tomato soup");
    expect(screen.queryByText("Opening your recipe…")).toBeNull();
    expect(screen.queryByText(/loading your private draft/i)).toBeNull();
    expect(screen.queryByText("Loading curated categories…")).toBeNull();
    expect(screen.getByText("All changes are saved privately.")).toHaveClass(
      "visually-hidden",
    );
    expect(
      screen
        .getByLabelText("Draft actions")
        .parentElement?.querySelector('[role="status"]'),
    ).toBeNull();
    expect(mocks.fetchRecipeDraft).not.toHaveBeenCalled();
  });

  it("reuses the recipe page shell when the prepared editor is embedded", () => {
    const { container } = renderEditor(detail, undefined, undefined, true);

    expect(container.querySelector("main")).toBeNull();
    expect(container.querySelector(".recipe-draft-inline")).toContainElement(
      screen.getByRole("form", { name: "Private recipe draft editor" }),
    );
  });

  it("reuses the route-shaped authoring skeleton while a private draft loads", () => {
    const { container } = render(
      <NavigationBlockerProvider>
        <RecipeDraftLoadingView draftId={DRAFT_ID} />
      </NavigationBlockerProvider>,
    );

    const loader = container.querySelector("main.page-loading--authoring");
    expect(loader).toHaveAttribute("aria-busy", "true");
    expect(loader).toHaveClass("recipe-workspace-page");
    expect(loader?.querySelector(".page-loading__recipe")).not.toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading your private draft…",
    );
    expect(screen.queryByText("Opening editor…")).toBeNull();
    expect(screen.queryByText("Opening your recipe…")).toBeNull();
  });

  it("shows zero public saves for a private draft", () => {
    renderEditor(detail);

    const noRatings = screen.getByLabelText("No ratings yet");
    const socialRow = noRatings.closest<HTMLElement>(
      ".recipe-detail__social-row",
    );

    expect(within(socialRow!).getByText("0 saves")).toBeVisible();
  });

  it("does not borrow the source recipe's saves for a private version draft", () => {
    const sourceId = "88888888-8888-4888-8888-888888888888";
    renderEditor(
      { ...detail, source_version_id: sourceId },
      undefined,
      { ...publicSourceRecipe(sourceId), save_count: 876 },
    );

    const socialRow = screen
      .getByLabelText("No ratings yet")
      .closest<HTMLElement>(".recipe-detail__social-row");

    expect(within(socialRow!).getByText("0 saves")).toBeVisible();
    expect(within(socialRow!).queryByText("876 saves")).toBeNull();
  });
});
