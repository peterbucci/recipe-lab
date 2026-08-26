import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RecipeDuplicatePreflight } from "../../lib/recipe-duplicate-api";
import {
  RecipeDuplicatePreflightReview,
  RecipeDuplicateUnavailable,
} from "./recipe-duplicate-preflight-review";

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

describe("RecipeDuplicatePreflightReview", () => {
  it("focuses an inline advisory review with bounded public candidate details", async () => {
    render(
      <RecipeDuplicatePreflightReview
        result={result()}
        acknowledged={false}
        decisionFailure={null}
        pendingDecision={null}
        onAcknowledgedChange={vi.fn()}
        onContinue={vi.fn()}
        onRevise={vi.fn()}
        onRetryDecision={vi.fn()}
        onCreateWithoutRecordedDecision={vi.fn()}
        onReturnWithoutRecordedDecision={vi.fn()}
      />,
    );

    const region = screen.getByRole("region", {
      name: "Review similar recipe structures",
    });
    await waitFor(() =>
      expect(
        within(region).getByRole("heading", {
          name: "Review similar recipe structures",
        }),
      ).toHaveFocus(),
    );
    const candidateLink = within(region).getByRole("link", {
      name: /Public carrot cake.*opens in a new tab/i,
    });
    expect(candidateLink).toHaveAttribute("href", `/recipes/${CANDIDATE_ID}`);
    expect(candidateLink).toHaveAttribute("target", "_blank");
    expect(candidateLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(candidateLink).toHaveTextContent("(opens in a new tab)");
    expect(within(region).getByText("88% similar")).toBeInTheDocument();
    expect(
      within(region).getByRole("list", {
        name: "Why Public carrot cake was included",
      }),
    ).toHaveTextContent("structured action flow is similar");
    expect(region).not.toHaveTextContent(/private|owner|timing|total candidates/i);
  });

  it("requires explicit acknowledgement before continuing and supports revise", () => {
    const acknowledge = vi.fn();
    const continueAction = vi.fn();
    const revise = vi.fn();
    const { rerender } = render(
      <RecipeDuplicatePreflightReview
        result={result()}
        acknowledged={false}
        decisionFailure={null}
        pendingDecision={null}
        onAcknowledgedChange={acknowledge}
        onContinue={continueAction}
        onRevise={revise}
        onRetryDecision={vi.fn()}
        onCreateWithoutRecordedDecision={vi.fn()}
        onReturnWithoutRecordedDecision={vi.fn()}
      />,
    );

    const continueButton = screen.getByRole("button", {
      name: "Create my version anyway",
    });
    expect(continueButton).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: /reviewed these advisory results/i,
      }),
    );
    expect(acknowledge).toHaveBeenCalledWith(true);

    rerender(
      <RecipeDuplicatePreflightReview
        result={result()}
        acknowledged
        decisionFailure={null}
        pendingDecision={null}
        onAcknowledgedChange={acknowledge}
        onContinue={continueAction}
        onRevise={revise}
        onRetryDecision={vi.fn()}
        onCreateWithoutRecordedDecision={vi.fn()}
        onReturnWithoutRecordedDecision={vi.fn()}
      />,
    );
    fireEvent.click(continueButton);
    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
    expect(continueAction).toHaveBeenCalledOnce();
    expect(revise).toHaveBeenCalledOnce();
  });

  it("uses explicit immutable-publication language for an original draft", () => {
    render(
      <RecipeDuplicatePreflightReview
        mode="publication"
        result={result()}
        acknowledged={false}
        decisionFailure={null}
        pendingDecision={null}
        onAcknowledgedChange={vi.fn()}
        onContinue={vi.fn()}
        onRevise={vi.fn()}
        onRetryDecision={vi.fn()}
        onCreateWithoutRecordedDecision={vi.fn()}
        onReturnWithoutRecordedDecision={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("checkbox", {
        name: "I reviewed these advisory results and want to publish my recipe anyway.",
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Publish recipe anyway" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /without similarity review/i })).toBeNull();
  });

  it("presents a direct-parent no-change warning without inventing a candidate", () => {
    render(
      <RecipeDuplicatePreflightReview
        result={result({
          classification: "exact_duplicate",
          same_lineage_no_change: true,
          candidates: [],
          warnings: [
            {
              code: "same_lineage_no_change",
              message: "The structured recipe is unchanged from its direct parent.",
            },
          ],
        })}
        acknowledged={false}
        decisionFailure={null}
        pendingDecision={null}
        onAcknowledgedChange={vi.fn()}
        onContinue={vi.fn()}
        onRevise={vi.fn()}
        onRetryDecision={vi.fn()}
        onCreateWithoutRecordedDecision={vi.fn()}
        onReturnWithoutRecordedDecision={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("region", {
        name: "This version keeps the same recipe structure",
      }),
    ).toHaveTextContent("unchanged from its direct parent");
    expect(screen.queryByRole("list", { name: "Public recipe matches" })).toBeNull();
  });

  it("disables every decision control while one choice is being recorded", () => {
    render(
      <RecipeDuplicatePreflightReview
        result={result()}
        acknowledged
        decisionFailure={null}
        pendingDecision="continue"
        onAcknowledgedChange={vi.fn()}
        onContinue={vi.fn()}
        onRevise={vi.fn()}
        onRetryDecision={vi.fn()}
        onCreateWithoutRecordedDecision={vi.fn()}
        onReturnWithoutRecordedDecision={vi.fn()}
      />,
    );

    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("checkbox")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Recording your choice…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Keep editing" })).toBeDisabled();
  });

  it.each([
    {
      decision: "continue" as const,
      fallbackLabel: "Create without confirming the review decision",
    },
    {
      decision: "revise" as const,
      fallbackLabel: "Return to editing without confirming the review decision",
    },
  ])("truthfully recovers when $decision cannot be recorded", async ({
    decision,
    fallbackLabel,
  }) => {
    const retry = vi.fn();
    const createWithout = vi.fn();
    const returnWithout = vi.fn();
    render(
      <RecipeDuplicatePreflightReview
        result={result()}
        acknowledged
        decisionFailure={decision}
        pendingDecision={null}
        onAcknowledgedChange={vi.fn()}
        onContinue={vi.fn()}
        onRevise={vi.fn()}
        onRetryDecision={retry}
        onCreateWithoutRecordedDecision={createWithout}
        onReturnWithoutRecordedDecision={returnWithout}
      />,
    );

    const failureHeading = screen.getByRole("heading", {
      name: "Your review choice could not be confirmed",
    });
    await waitFor(() => expect(failureHeading).toHaveFocus());
    expect(
      screen.getByText("No confirmed response was received for your review decision."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry recording my choice" }));
    fireEvent.click(screen.getByRole("button", { name: fallbackLabel }));
    expect(retry).toHaveBeenCalledOnce();
    if (decision === "continue") {
      expect(createWithout).toHaveBeenCalledOnce();
      expect(returnWithout).not.toHaveBeenCalled();
    } else {
      expect(returnWithout).toHaveBeenCalledOnce();
      expect(createWithout).not.toHaveBeenCalled();
    }
  });
});

describe("RecipeDuplicateUnavailable", () => {
  it("offers two explicit neutral choices without inventing a classification", async () => {
    const retry = vi.fn();
    const create = vi.fn();
    render(
      <RecipeDuplicateUnavailable
        pendingAction={null}
        onRetry={retry}
        onCreateWithoutReview={create}
      />,
    );

    const region = screen.getByRole("region", {
      name: "Similarity review could not be completed",
    });
    await waitFor(() =>
      expect(
        within(region).getByRole("heading", {
          name: "Similarity review could not be completed",
        }),
      ).toHaveFocus(),
    );
    expect(region).toHaveTextContent("does not mean your version is distinct");
    expect(region).toHaveTextContent("No similarity classification was produced.");
    fireEvent.click(within(region).getByRole("button", { name: "Retry similarity review" }));
    fireEvent.click(
      within(region).getByRole("button", {
        name: "Create without similarity review",
      }),
    );
    expect(retry).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce();
  });
});
