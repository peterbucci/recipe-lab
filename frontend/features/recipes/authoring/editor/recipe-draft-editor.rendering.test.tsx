import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { NavigationBlockerProvider } from "../../../../shared/navigation/navigation-blocker-provider";
import {
  cleanupRecipeDraftEditorMocks,
  detail,
  DRAFT_ID,
  getRecipeDraftEditorMocks,
  publicSourceRecipe,
  renderEditor,
  RecipeDraftApiError,
  resetRecipeDraftEditorMocks,
} from "./recipe-draft-editor-test-support";
import { RecipeDraftLoadingView } from "../draft/recipe-draft-route-states";

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
        <RecipeDraftLoadingView />
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

  it("aborts the initial private-draft load when the editor unmounts", async () => {
    mocks.fetchRecipeDraft.mockReturnValue(new Promise(() => undefined));
    const view = renderEditor();

    await waitFor(() => expect(mocks.fetchRecipeDraft).toHaveBeenCalledOnce());
    const signal = mocks.fetchRecipeDraft.mock.calls[0]?.[1];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal?.aborted).toBe(false);

    view.unmount();
    expect(signal?.aborted).toBe(true);
  });

  it.each([
    "Draft not found for a private identifier.",
    "Draft belongs to a different account.",
  ])("conceals a terminal draft lookup regardless of upstream detail", async (detailMessage) => {
    mocks.fetchRecipeDraft.mockRejectedValueOnce(
      new RecipeDraftApiError(
        detailMessage,
        404,
        "recipe_draft_not_found",
      ),
    );

    renderEditor();

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "We couldn’t open that draft.",
      }),
    ).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.queryByText(detailMessage)).toBeNull();
    expect(screen.queryByText(DRAFT_ID)).toBeNull();
    expect(screen.getByRole("link", { name: "My recipes" })).toHaveAttribute(
      "href",
      "/account/recipes?view=drafts",
    );
  });

  it("retries a transient draft lookup and opens the recovered editor", async () => {
    mocks.fetchRecipeDraft
      .mockRejectedValueOnce(
        new RecipeDraftApiError("Private upstream detail", 503),
      )
      .mockResolvedValueOnce(detail);

    renderEditor();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn’t load this draft.");
    expect(alert).not.toHaveTextContent("Private upstream detail");
    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(
      await screen.findByRole("form", { name: "Private recipe draft editor" }),
    ).toBeVisible();
    expect(mocks.fetchRecipeDraft).toHaveBeenCalledTimes(2);
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
