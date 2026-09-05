import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { RecipeDraftIdentityFields } from "./recipe-draft-details-section";

function renderIdentityFields(description: string, titleContext?: ReactNode) {
  return (
    <RecipeDraftIdentityFields
      description={description}
      disabled={false}
      errors={{}}
      isVersion
      onDescriptionChange={vi.fn()}
      onTitleChange={vi.fn()}
      title="Banana oat pancakes"
      titleContext={titleContext}
    />
  );
}

describe("RecipeDraftIdentityFields", () => {
  it("uses read-view mirrors to size editable title and description rows", () => {
    const { container, rerender } = render(
      renderIdentityFields("One rendered line"),
    );

    const description = screen.getByLabelText("Description");
    const title = screen.getByLabelText("Title");
    const titleMirror = container.querySelector(
      ".recipe-workspace__title-mirror",
    );
    const descriptionMirror = container.querySelector(
      ".recipe-workspace__description-mirror",
    );

    expect(titleMirror).toHaveTextContent("Banana oat pancakes");
    expect(descriptionMirror).toHaveTextContent("One rendered line");
    expect(title).toHaveClass("recipe-workspace__editable-text");
    expect(description).toHaveClass("recipe-workspace__editable-text");
    expect(description).toHaveAttribute("rows", "1");
    expect(description).not.toHaveAttribute("style");

    rerender(renderIdentityFields("First line\nSecond line"));

    expect(descriptionMirror?.textContent).toBe("First line\nSecond line");
  });

  it("places optional recipe lineage between the title and description", () => {
    const { container } = render(
      renderIdentityFields(
        "One rendered line",
        <p className="recipe-detail__parent-context">Based on a recipe</p>,
      ),
    );

    const title = screen.getByLabelText("Title").closest("h1");
    const context = container.querySelector(".recipe-detail__parent-context");
    const description = screen
      .getByLabelText("Description")
      .closest(".recipe-workspace__description-field");

    expect(context).toHaveTextContent("Based on a recipe");
    expect(
      title!.compareDocumentPosition(context!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      context!.compareDocumentPosition(description!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
