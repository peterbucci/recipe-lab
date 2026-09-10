import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import type { RecipeDuplicatePreflight } from "./recipe-duplicate-api";
import { RecipeDuplicatePreflightReview } from "./recipe-duplicate-preflight-review";

const CANDIDATE_ID = "33333333-3333-4333-8333-333333333333";

function result(
  overrides: Partial<RecipeDuplicatePreflight> = {},
): RecipeDuplicatePreflight {
  return {
    classification: "probable_duplicate",
    same_lineage_no_change: false,
    candidates: [
      {
        public_recipe_version_id: CANDIDATE_ID,
        title: "Public carrot cake",
        classification: "probable_duplicate",
        score: "0.875000",
        reasons: [
          {
            code: "same_curated_ingredient_multiset",
            message: "The curated ingredient set is the same.",
          },
          {
            code: "similar_structured_action_flow",
            message: "The structured action flow is similar.",
          },
        ],
      },
    ],
    warnings: [],
    acknowledgement: {
      preflight_id: "22222222-2222-4222-8222-222222222222",
      policy_version: "recipe-duplicate-preflight-policy-v1",
      result_digest: "a".repeat(64),
      required: true,
      allowed_decisions: ["continue", "revise"],
    },
    ...overrides,
  };
}

function reviewProps(
  overrides: Partial<ComponentProps<typeof RecipeDuplicatePreflightReview>> = {},
): ComponentProps<typeof RecipeDuplicatePreflightReview> {
  return {
    acknowledged: false,
    onAcknowledgedChange: vi.fn(),
    onContinue: vi.fn(),
    onRevise: vi.fn(),
    pendingDecision: null,
    publicationKind: "original",
    result: result(),
    ...overrides,
  };
}

describe("RecipeDuplicatePreflightReview", () => {
  it("presents the live original-publication review and its bounded evidence", async () => {
    const props = reviewProps({
      confirmationSlot: <p>Confirm publication details</p>,
    });
    const view = render(<RecipeDuplicatePreflightReview {...props} />);

    const region = screen.getByRole("region", {
      name: "This recipe is similar to another public recipe",
    });
    expect(region).toHaveClass("duplicate-preflight-review--publication");
    await waitFor(() =>
      expect(
        within(region).getByRole("heading", {
          name: "This recipe is similar to another public recipe",
        }),
      ).toHaveFocus(),
    );
    const candidateLink = within(region).getByRole("link", {
      name: /Public carrot cake.*opens in a new tab/i,
    });
    expect(candidateLink).toHaveAttribute("href", `/recipes/${CANDIDATE_ID}`);
    expect(candidateLink).toHaveAttribute("target", "_blank");
    expect(candidateLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(
      within(region).getByText("Why is Recipe Lab showing this?").closest("details"),
    ).not.toHaveAttribute("open");
    expect(region).toHaveTextContent("order of cooking actions is similar");
    expect(region).not.toHaveTextContent("The structured action flow is similar.");
    expect(region).toHaveTextContent("Confirm publication details");

    const acknowledgement = within(region).getByRole("checkbox", {
      name: "I reviewed these similar recipes and want to publish my recipe anyway.",
    });
    expect(within(region).getByRole("button", { name: "Publish recipe" })).toBeDisabled();
    fireEvent.click(acknowledgement);
    expect(props.onAcknowledgedChange).toHaveBeenCalledWith(true);

    view.rerender(
      <RecipeDuplicatePreflightReview {...props} acknowledged />,
    );
    fireEvent.click(within(region).getByRole("button", { name: "Publish recipe" }));
    fireEvent.click(within(region).getByRole("button", { name: "Keep editing" }));
    expect(props.onContinue).toHaveBeenCalledOnce();
    expect(props.onRevise).toHaveBeenCalledOnce();
    expect(within(region).getByRole("status")).toHaveClass("visually-hidden");
  });

  it("uses the compact source-match confirmation for a publication version", () => {
    render(
      <RecipeDuplicatePreflightReview
        {...reviewProps({
          publicationKind: "fork",
          result: result({
            classification: "exact_duplicate",
            same_lineage_no_change: true,
            candidates: [],
            warnings: [
              {
                code: "same_lineage_no_change",
                message: "The structured recipe is unchanged from its direct parent.",
              },
            ],
          }),
        })}
      />,
    );

    const review = screen.getByRole("region", {
      name: "This version is very close to its source",
    });
    expect(review).toHaveTextContent(
      "You can still publish it as a separate version if that’s intentional.",
    );
    expect(
      within(review).getByRole("checkbox", {
        name: /closely matches its source.*publish it separately/i,
      }),
    ).not.toBeChecked();
    expect(within(review).getByRole("button", { name: "Publish version" })).toBeDisabled();
    expect(review).toHaveTextContent(
      "The ingredients, amounts, and cooking actions match its source.",
    );
  });

  it("disables every publication decision while publishing", () => {
    render(
      <RecipeDuplicatePreflightReview
        {...reviewProps({ acknowledged: true, pendingDecision: "continue" })}
      />,
    );

    const region = screen.getByRole("region");
    expect(region).toHaveAttribute("aria-busy", "true");
    expect(within(region).getByRole("checkbox")).toBeDisabled();
    expect(
      within(region).getByRole("button", { name: "Publishing your recipe…" }),
    ).toBeDisabled();
    expect(within(region).getByRole("button", { name: "Keep editing" })).toBeDisabled();
    expect(within(region).queryByRole("status")).toBeNull();
  });
});
