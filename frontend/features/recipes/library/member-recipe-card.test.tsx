import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { original, ROOT_ID, STABLE_RECIPE_ID } from "../shared/recipe-test-support";
import { MemberRecipeCard } from "./member-recipe-card";

describe("MemberRecipeCard edition destinations", () => {
  it("keeps a saved edition exact and links a readable newer edition through stable identity", () => {
    render(
      <MemberRecipeCard
        recipe={original({
          current_version: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            title: "Current tomato soup",
            version_number: 2,
            author: original().author,
          },
          is_current: false,
        })}
        state="saved"
      />,
    );

    const card = screen.getByRole("article", { name: "Alice’s tomato soup" });
    expect(within(card).getByRole("link", { name: "Alice’s tomato soup" })).toHaveAttribute("href", `/recipes/${ROOT_ID}`);
    expect(within(card).getByRole("link", { name: "View recipe" })).toHaveAttribute("href", `/recipes/${ROOT_ID}`);
    expect(within(card).getByRole("link", { name: "Newer version available" })).toHaveAttribute("href", `/recipes/current/${STABLE_RECIPE_ID}`);
  });

  it("does not invent a link when the newer current edition is hidden", () => {
    render(<MemberRecipeCard recipe={original({ is_current: false })} state="saved" />);
    expect(screen.getByText("Newer version available")).not.toHaveRole("link");
  });

  it("uses stable identity for an authored published card", () => {
    render(<MemberRecipeCard recipe={original()} state="published" />);
    expect(screen.getByRole("link", { name: "View recipe" })).toHaveAttribute("href", `/recipes/current/${STABLE_RECIPE_ID}`);
  });
});
