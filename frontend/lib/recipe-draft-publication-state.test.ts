import { describe, expect, it } from "vitest";

import type { RecipeDuplicatePreflight } from "./recipe-duplicate-api";
import {
  initialRecipeDraftPublicationState,
  preparePublicationAttempt,
  publicationContext,
  publicationIsBusy,
  publicationReview,
  publicationScopeMatches,
  recipeDraftPublicationReducer,
  type PublicationContext,
  type PublicationFailureStatus,
  type PublicationScope,
  type RecipeDraftPublicationState,
} from "./recipe-draft-publication-state";

const PREFLIGHT_KEY = "11111111-1111-4111-8111-111111111111";
const NEXT_PREFLIGHT_KEY = "22222222-2222-4222-8222-222222222222";
const PUBLISH_KEY = "33333333-3333-4333-8333-333333333333";
const NEXT_PUBLISH_KEY = "44444444-4444-4444-8444-444444444444";
const RECIPE_ID = "55555555-5555-4555-8555-555555555555";
const CANDIDATE_ID = "66666666-6666-4666-8666-666666666666";

const scope: PublicationScope = {
  fingerprint: "saved-draft-fingerprint",
  revision: 4,
};

const probableResult: RecipeDuplicatePreflight = {
  classification: "probable_duplicate",
  same_lineage_no_change: false,
  candidates: [
    {
      public_recipe_version_id: CANDIDATE_ID,
      title: "Similar soup",
      classification: "probable_duplicate",
      score: "0.875000",
      reasons: [
        {
          code: "matching_structure",
          message: "The structures are similar.",
        },
      ],
    },
  ],
  warnings: [],
  acknowledgement: {
    preflight_id: PREFLIGHT_KEY,
    policy_version: "recipe-duplicate-preflight-policy-v1",
    result_digest: "a".repeat(64),
    required: true,
    allowed_decisions: ["continue", "revise"],
  },
};

const distinctResult: RecipeDuplicatePreflight = {
  classification: "distinct",
  same_lineage_no_change: false,
  candidates: [],
  warnings: [],
  acknowledgement: {
    preflight_id: PREFLIGHT_KEY,
    policy_version: "recipe-duplicate-preflight-policy-v1",
    result_digest: "b".repeat(64),
    required: false,
    allowed_decisions: [],
  },
};

const probableContext: PublicationContext = {
  decision: "continue",
  result: probableResult,
  scope,
};

const publishAttempt = {
  fingerprint: `${scope.revision}:${scope.fingerprint}:continue`,
  idempotencyKey: PUBLISH_KEY,
};

function publishingState(
  context: PublicationContext = probableContext,
): RecipeDraftPublicationState {
  return recipeDraftPublicationReducer(initialRecipeDraftPublicationState, {
    attempt: publishAttempt,
    context,
    type: "publish-started",
  });
}

describe("recipe draft publication domain state", () => {
  it("reuses an attempt for one fingerprint and rotates it for a new intent", () => {
    const first = preparePublicationAttempt(null, {
      fingerprint: "revision-4:preflight",
      newIdempotencyKey: PREFLIGHT_KEY,
    });
    expect(
      preparePublicationAttempt(first, {
        fingerprint: "revision-4:preflight",
        newIdempotencyKey: NEXT_PREFLIGHT_KEY,
      }),
    ).toBe(first);
    expect(
      preparePublicationAttempt(first, {
        fingerprint: "revision-5:preflight",
        newIdempotencyKey: NEXT_PREFLIGHT_KEY,
      }),
    ).toEqual({
      fingerprint: "revision-5:preflight",
      idempotencyKey: NEXT_PREFLIGHT_KEY,
    });

    expect(publicationScopeMatches(scope, { ...scope }, false)).toBe(true);
    expect(publicationScopeMatches(scope, { ...scope }, true)).toBe(false);
    expect(
      publicationScopeMatches(scope, { ...scope, revision: 5 }, false),
    ).toBe(false);
    expect(
      publicationScopeMatches(
        scope,
        { ...scope, fingerprint: "different-draft" },
        false,
      ),
    ).toBe(false);
  });

  it("moves validation through review, acknowledgement, publishing, and published", () => {
    const validating = recipeDraftPublicationReducer(
      initialRecipeDraftPublicationState,
      { type: "validation-started" },
    );
    expect(validating.workflow).toEqual({
      phase: "validating",
      status: "reviewing",
    });
    expect(publicationIsBusy(validating)).toBe(false);

    const preflightAttempt = preparePublicationAttempt(null, {
      fingerprint: `${scope.revision}:${scope.fingerprint}`,
      newIdempotencyKey: PREFLIGHT_KEY,
    });
    const checking = recipeDraftPublicationReducer(validating, {
      attempt: preflightAttempt,
      scope,
      type: "preflight-started",
    });
    expect(checking.workflow).toEqual({
      phase: "checking",
      scope,
      status: "reviewing",
    });
    expect(publicationIsBusy(checking)).toBe(true);

    const staleReview = recipeDraftPublicationReducer(checking, {
      attemptId: NEXT_PREFLIGHT_KEY,
      result: probableResult,
      type: "review-required",
    });
    expect(staleReview).toBe(checking);

    const reviewRequired = recipeDraftPublicationReducer(checking, {
      attemptId: PREFLIGHT_KEY,
      result: probableResult,
      type: "review-required",
    });
    expect(reviewRequired.workflow).toMatchObject({
      acknowledged: false,
      status: "confirmation",
    });
    expect(publicationReview(reviewRequired.workflow)).toMatchObject({
      acknowledged: false,
      review: { result: probableResult, scope },
    });

    const acknowledged = recipeDraftPublicationReducer(reviewRequired, {
      acknowledged: true,
      type: "acknowledgement-changed",
    });
    expect(publicationReview(acknowledged.workflow)).toMatchObject({
      acknowledged: true,
    });

    const publishing = recipeDraftPublicationReducer(acknowledged, {
      attempt: publishAttempt,
      context: probableContext,
      type: "publish-started",
    });
    expect(publishing.workflow).toEqual({
      acknowledged: true,
      context: probableContext,
      status: "publishing",
    });
    expect(publicationIsBusy(publishing)).toBe(true);
    expect(publicationContext(publishing.workflow)).toBe(probableContext);
    expect(publicationReview(publishing.workflow)).toMatchObject({
      acknowledged: true,
      review: probableContext,
    });

    const staleCompletion = recipeDraftPublicationReducer(publishing, {
      attemptId: NEXT_PUBLISH_KEY,
      receipt: {
        location: `/recipes/${RECIPE_ID}`,
        recipe_version_id: RECIPE_ID,
      },
      type: "published",
    });
    expect(staleCompletion).toBe(publishing);

    const receipt = {
      location: `/recipes/${RECIPE_ID}`,
      recipe_version_id: RECIPE_ID,
    };
    const published = recipeDraftPublicationReducer(publishing, {
      attemptId: PUBLISH_KEY,
      receipt,
      type: "published",
    });
    expect(published.workflow).toEqual({
      acknowledged: true,
      context: probableContext,
      receipt,
      status: "published",
    });
    expect(publicationIsBusy(published)).toBe(true);
    expect(publicationReview(published.workflow)).toMatchObject({
      acknowledged: true,
      review: probableContext,
    });
  });

  it.each([
    "ambiguous-result",
    "authentication-interruption",
    "failed-retryable",
    "revision-conflict",
    "source-unavailable",
  ] satisfies PublicationFailureStatus[])(
    "retains a scoped publish attempt after a %s failure",
    (kind) => {
      const publishing = publishingState();
      const failed = recipeDraftPublicationReducer(publishing, {
        attemptId: PUBLISH_KEY,
        kind,
        message: `Stable ${kind} message`,
        operation: "publish",
        resetReview: false,
        type: "operation-failed",
      });

      expect(failed.workflow).toEqual({
        acknowledged: true,
        context: probableContext,
        kind,
        message: `Stable ${kind} message`,
        operation: "publish",
        recovery:
          kind === "revision-conflict"
            ? "latest-draft"
            : kind === "source-unavailable"
              ? "source"
              : "publish",
        scope,
        status: "failed",
      });
      expect(publicationContext(failed.workflow)).toBe(probableContext);
      expect(publicationReview(failed.workflow)).toMatchObject({
        acknowledged: true,
        review: probableContext,
      });
      const unacknowledged = recipeDraftPublicationReducer(failed, {
        acknowledged: false,
        type: "acknowledgement-changed",
      });
      expect(publicationReview(unacknowledged.workflow)).toMatchObject({
        acknowledged: false,
      });
      expect(
        preparePublicationAttempt(failed.attempts.publish, {
          fingerprint: publishAttempt.fingerprint,
          newIdempotencyKey: NEXT_PUBLISH_KEY,
        }),
      ).toBe(publishAttempt);
    },
  );

  it("ignores stale failures and clears obsolete attempts when review must restart", () => {
    const preflightAttempt = {
      fingerprint: `${scope.revision}:${scope.fingerprint}`,
      idempotencyKey: PREFLIGHT_KEY,
    };
    const checking = recipeDraftPublicationReducer(
      initialRecipeDraftPublicationState,
      { attempt: preflightAttempt, scope, type: "preflight-started" },
    );

    const staleFailure = recipeDraftPublicationReducer(checking, {
      attemptId: NEXT_PREFLIGHT_KEY,
      kind: "ambiguous-result",
      message: "Stale failure",
      operation: "preflight",
      resetReview: false,
      type: "operation-failed",
    });
    expect(staleFailure).toBe(checking);

    const conflicted = recipeDraftPublicationReducer(checking, {
      attemptId: PREFLIGHT_KEY,
      kind: "revision-conflict",
      message: "The draft changed.",
      operation: "preflight",
      resetReview: true,
      type: "operation-failed",
    });
    expect(conflicted.attempts).toEqual({ preflight: null, publish: null });
    expect(conflicted.workflow).toEqual({
      acknowledged: false,
      context: null,
      kind: "revision-conflict",
      message: "The draft changed.",
      operation: "preflight",
      recovery: "latest-draft",
      scope,
      status: "failed",
    });
    expect(
      preparePublicationAttempt(conflicted.attempts.preflight, {
        fingerprint: `${scope.revision + 1}:new-draft`,
        newIdempotencyKey: NEXT_PREFLIGHT_KEY,
      }),
    ).toEqual({
      fingerprint: `${scope.revision + 1}:new-draft`,
      idempotencyKey: NEXT_PREFLIGHT_KEY,
    });
  });

  it("models confirmation removal, keep-editing, and changed-draft intents explicitly", () => {
    const pausedReview = recipeDraftPublicationReducer(publishingState(), {
      context: probableContext,
      type: "confirmation-paused",
    });
    expect(pausedReview.workflow).toMatchObject({
      acknowledged: true,
      review: probableContext,
      status: "confirmation",
    });

    const keepEditing = recipeDraftPublicationReducer(pausedReview, {
      type: "keep-editing",
    });
    expect(keepEditing.attempts.publish).toBeNull();
    expect(keepEditing.workflow).toEqual({ status: "idle" });

    const changed = recipeDraftPublicationReducer(keepEditing, {
      type: "draft-changed",
    });
    expect(changed.workflow).toEqual({ status: "idle" });

    const distinctContext: PublicationContext = {
      decision: null,
      result: distinctResult,
      scope,
    };
    const pausedDistinct = recipeDraftPublicationReducer(
      publishingState(distinctContext),
      { context: distinctContext, type: "confirmation-paused" },
    );
    expect(pausedDistinct.workflow).toEqual({ status: "idle" });

    const invalid = recipeDraftPublicationReducer(
      recipeDraftPublicationReducer(initialRecipeDraftPublicationState, {
        type: "validation-started",
      }),
      { type: "validation-failed" },
    );
    expect(invalid.workflow).toEqual({ status: "idle" });
  });
});
