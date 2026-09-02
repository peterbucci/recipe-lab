import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RecipeCardShell } from "./recipe-card-shell";

describe("RecipeCardShell", () => {
  it("keeps the artwork and domain content in an accessible list-card frame", () => {
    render(
      <ul>
        <RecipeCardShell
          aria-labelledby="test-recipe-title"
          artwork={<div className="test-artwork">Artwork</div>}
          bodyClassName="test-body"
          className="test-card"
          itemClassName="test-item"
        >
          <h3 id="test-recipe-title">Test recipe</h3>
          <button type="button">Domain action</button>
        </RecipeCardShell>
      </ul>,
    );

    const item = screen.getByRole("listitem");
    const card = screen.getByRole("article", { name: "Test recipe" });
    const artwork = card.querySelector(".test-artwork");
    const body = card.querySelector(".test-body");

    expect(item).toHaveClass("test-item");
    expect(card).toHaveClass("test-card");
    expect(item).toContainElement(card);
    expect(card.firstElementChild).toBe(artwork);
    expect(artwork?.nextElementSibling).toBe(body);
    expect(body).toContainElement(
      screen.getByRole("button", { name: "Domain action" }),
    );
  });
});
