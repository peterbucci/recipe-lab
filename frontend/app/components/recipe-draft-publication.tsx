"use client";

import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";

import { AuthApiError } from "../../lib/auth-api";
import type { CatalogActionType } from "../../lib/cooking-action-api";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import {
  createRecipeDraftDuplicatePreflight,
  RecipeDuplicateApiError,
} from "../../lib/recipe-duplicate-api";
import {
  duplicateReviewForPublication,
  publishRecipeDraft,
  RecipePublicationApiError,
} from "../../lib/recipe-publication-api";
import {
  recipeDraftFingerprint,
  recipeDraftFieldErrorsFromIssues,
  type RecipeDraftEditorState,
  type RecipeDraftValidation,
  validateRecipeDraftForPublication,
} from "../../lib/recipe-draft";
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
} from "../../lib/recipe-draft-publication-state";
import { GuardedLink, useNavigationBlocker } from "./navigation-blocker-provider";
import { RecipeDuplicatePreflightReview } from "./recipe-duplicate-preflight-review";

interface RecipeDraftPublicationProps {
  actionTypes: readonly CatalogActionType[];
  draft: RecipeDraftEditorState;
  draftId: string;
  dirty: boolean;
  measurementUnits: readonly CatalogUnit[];
  onBusyChange: (busy: boolean) => void;
  onValidation: (validation: RecipeDraftValidation) => void;
  revision: number;
  sourceVersionId: string | null;
}

type PendingOperation = "preflight" | "publish" | null;
type RetryOperation = "preflight" | "publish" | null;

const PUBLICATION_CONFIRMATION_MESSAGE =
  "Confirm the community rules and your right to share this recipe before publishing.";

function publicationFailureMessage(
  reason: unknown,
  operation: Exclude<RetryOperation, null>,
  isVersion: boolean,
  kind: PublicationFailureStatus,
): string {
  const apiError =
    reason instanceof AuthApiError ||
    reason instanceof RecipeDuplicateApiError ||
    reason instanceof RecipePublicationApiError
      ? reason
      : null;
  if (apiError?.status === 401) {
    return "Your session expired. Your draft is still here; sign in again before continuing.";
  }
  if (apiError?.code === "recipe_fork_source_unavailable") {
    return "The recipe this version is based on is no longer available. Your private draft is unchanged.";
  }
  if (apiError?.code === "recipe_draft_revision_conflict") {
    return "This draft changed in another tab. Open the latest saved draft before publishing.";
  }
  if (apiError?.status === 422) {
    return "Some draft fields need attention. Review them before publishing.";
  }
  if (kind === "ambiguous-result") {
    return operation === "publish"
      ? `Recipe Lab did not receive a clear publication result. Your ${isVersion ? "version" : "recipe"} may already be published. Checking this same attempt is safe and cannot create a second publication.`
      : "Recipe Lab did not receive a clear similar-recipes result. Publishing is paused, and your saved draft is still here.";
  }
  return operation === "preflight"
    ? "Similar recipes could not be checked right now. Publishing waits until this check succeeds, and your saved draft is still here."
    : `Recipe Lab could not publish this ${isVersion ? "version" : "recipe"}. Your saved draft is still here.`;
}

function publicationFailureHeading(
  kind: PublicationFailureStatus,
  operation: Exclude<RetryOperation, null>,
): string {
  if (kind === "authentication-interruption") return "Sign in to continue";
  if (kind === "revision-conflict") return "Review the latest draft";
  if (kind === "source-unavailable") return "Source recipe unavailable";
  if (operation === "preflight") return "Similar-recipes check unavailable";
  if (kind === "ambiguous-result") return "Publication result is unclear";
  return "Publication was interrupted";
}

function publicationFailureStatus(reason: unknown): PublicationFailureStatus {
  if (
    (reason instanceof AuthApiError ||
      reason instanceof RecipeDuplicateApiError ||
      reason instanceof RecipePublicationApiError) &&
    reason.status === 401
  ) {
    return "authentication-interruption";
  }
  if (
    (reason instanceof RecipeDuplicateApiError || reason instanceof RecipePublicationApiError) &&
    reason.code === "recipe_fork_source_unavailable"
  ) {
    return "source-unavailable";
  }
  if (
    (reason instanceof RecipeDuplicateApiError || reason instanceof RecipePublicationApiError) &&
    reason.code === "recipe_draft_revision_conflict"
  ) {
    return "revision-conflict";
  }
  if (
    !(reason instanceof AuthApiError) &&
    !(reason instanceof RecipeDuplicateApiError) &&
    !(reason instanceof RecipePublicationApiError)
  ) {
    return "ambiguous-result";
  }
  if (
    reason instanceof RecipePublicationApiError &&
    reason.code === "invalid_recipe_publication_response"
  ) {
    return "ambiguous-result";
  }
  return "failed-retryable";
}

export function RecipeDraftPublication({
  actionTypes,
  draft,
  draftId,
  dirty,
  measurementUnits,
  onBusyChange,
  onValidation,
  revision,
  sourceVersionId,
}: RecipeDraftPublicationProps) {
  const router = useRouter();
  const { setBlocked } = useNavigationBlocker();
  const fingerprint = recipeDraftFingerprint(draft);
  const currentScope: PublicationScope = { fingerprint, revision };
  const latestIntent = useRef({ dirty, fingerprint, revision });
  const submitting = useRef(false);
  const communityRulesRef = useRef<HTMLInputElement>(null);
  const contentRightsRef = useRef<HTMLInputElement>(null);
  const [publicationState, dispatchPublication] = useReducer(
    recipeDraftPublicationReducer,
    initialRecipeDraftPublicationState,
  );
  const confirmationScope = `${revision}:${fingerprint}`;
  const [communityRulesConfirmation, setCommunityRulesConfirmation] = useState({
    scope: "",
    checked: false,
  });
  const [contentRightsConfirmation, setContentRightsConfirmation] = useState({
    scope: "",
    checked: false,
  });
  const [confirmationFailure, setConfirmationFailure] = useState<{
    scope: string;
    message: string;
  } | null>(null);
  const communityRulesAccepted =
    communityRulesConfirmation.scope === confirmationScope && communityRulesConfirmation.checked;
  const contentRightsConfirmed =
    contentRightsConfirmation.scope === confirmationScope && contentRightsConfirmation.checked;
  const confirmationError =
    confirmationFailure?.scope === confirmationScope ? confirmationFailure.message : "";
  const [status, setStatus] = useState("");
  const isFork = sourceVersionId !== null;
  const workflow = publicationState.workflow;
  const failureWorkflow =
    workflow.status === "ambiguous-result" ||
    workflow.status === "authentication-interruption" ||
    workflow.status === "failed-retryable" ||
    workflow.status === "revision-conflict" ||
    workflow.status === "source-unavailable"
      ? workflow
      : null;
  const pending: PendingOperation =
    workflow.status === "checking"
      ? "preflight"
      : workflow.status === "publishing" || workflow.status === "published"
        ? "publish"
        : null;
  const retryOperation: RetryOperation =
    failureWorkflow?.status === "source-unavailable"
      ? null
      : failureWorkflow?.operation === "publish" && failureWorkflow.context === null
        ? "preflight"
        : failureWorkflow?.operation ?? null;
  const workflowReview = publicationReview(workflow);
  const retryContext = publicationContext(workflow);
  const currentRetryContext =
    retryContext && publicationScopeMatches(retryContext.scope, currentScope, dirty)
      ? retryContext
      : null;
  const activeReview =
    workflowReview && publicationScopeMatches(workflowReview.review.scope, currentScope, dirty)
      ? workflowReview
      : null;
  const reviewInvalidated = workflowReview !== null && activeReview === null;
  const error = failureWorkflow?.message ?? "";
  const failureHeading = failureWorkflow
    ? publicationFailureHeading(failureWorkflow.status, failureWorkflow.operation)
    : "";
  const ambiguousPublicationResult =
    failureWorkflow?.status === "ambiguous-result" && retryOperation === "publish";
  const revisionConflict = failureWorkflow?.status === "revision-conflict";
  const sessionExpired = failureWorkflow?.status === "authentication-interruption";
  const sourceUnavailable = failureWorkflow?.status === "source-unavailable";

  useEffect(
    () => onBusyChange(publicationIsBusy(publicationState)),
    [onBusyChange, publicationState],
  );

  useLayoutEffect(() => {
    latestIntent.current = { dirty, fingerprint, revision };
  }, [dirty, fingerprint, revision]);

  function intentIsCurrent(expectedFingerprint: string, expectedRevision: number): boolean {
    const current = latestIntent.current;
    return (
      !current.dirty &&
      current.fingerprint === expectedFingerprint &&
      current.revision === expectedRevision
    );
  }

  function livePublicationAttestations(): {
    community_rules_accepted: true;
    content_rights_confirmed: true;
  } | null {
    if (
      communityRulesRef.current?.checked !== true ||
      contentRightsRef.current?.checked !== true
    ) {
      return null;
    }
    return {
      community_rules_accepted: true,
      content_rights_confirmed: true,
    };
  }

  function pauseForMissingPublicationConfirmation(
    expectedScope: string,
    context: PublicationContext,
    preserveExistingFailure: boolean,
  ) {
    submitting.current = false;
    if (!preserveExistingFailure) {
      dispatchPublication({ context, type: "confirmation-paused" });
    }
    setConfirmationFailure({
      scope: expectedScope,
      message: PUBLICATION_CONFIRMATION_MESSAGE,
    });
    setStatus(
      "Publishing paused because a required confirmation was removed. Your draft is still here.",
    );
    window.setTimeout(() => {
      if (communityRulesRef.current?.checked !== true) {
        communityRulesRef.current?.focus();
      } else if (contentRightsRef.current?.checked !== true) {
        contentRightsRef.current?.focus();
      }
    }, 0);
  }

  function finishFailure(
    reason: unknown,
    operation: Exclude<RetryOperation, null>,
    attemptId: string,
  ) {
    const sourceWasUnavailable =
      isFork &&
      (reason instanceof RecipeDuplicateApiError || reason instanceof RecipePublicationApiError) &&
      reason.status === 409 &&
      reason.code === "recipe_fork_source_unavailable";
    submitting.current = false;
    const resetReview =
      (reason instanceof RecipeDuplicateApiError || reason instanceof RecipePublicationApiError) &&
      reason.status === 409;
    const failureKind = sourceWasUnavailable
      ? "source-unavailable"
      : publicationFailureStatus(reason);
    const failureMessage = publicationFailureMessage(reason, operation, isFork, failureKind);
    dispatchPublication({
      attemptId,
      kind: failureKind,
      message: failureMessage,
      operation,
      resetReview,
      type: "operation-failed",
    });
    if (reason instanceof RecipePublicationApiError && reason.issues.length > 0) {
      const serverFieldErrors = recipeDraftFieldErrorsFromIssues(draft, reason.issues);
      onValidation({
        fieldErrors: serverFieldErrors,
        formErrors: Object.keys(serverFieldErrors).length > 0 ? [] : [failureMessage],
        payload: null,
      });
    }
    setStatus("");
  }

  async function publish(context: PublicationContext, preserveExistingFailure: boolean) {
    const { result, scope, decision } = context;
    const expectedFingerprint = scope.fingerprint;
    const expectedRevision = scope.revision;
    if (!intentIsCurrent(expectedFingerprint, expectedRevision)) {
      submitting.current = false;
      dispatchPublication({ type: "draft-changed" });
      setStatus("Your draft changed. Save it before publishing.");
      return;
    }
    const attestations = livePublicationAttestations();
    if (!attestations) {
      pauseForMissingPublicationConfirmation(
        `${expectedRevision}:${expectedFingerprint}`,
        context,
        preserveExistingFailure,
      );
      return;
    }
    const duplicateReview = duplicateReviewForPublication(result, decision);
    const attemptFingerprint = JSON.stringify({
      revision: expectedRevision,
      duplicate_review: duplicateReview,
    });
    const attempt =
      publicationState.attempts.publish?.fingerprint === attemptFingerprint
        ? publicationState.attempts.publish
        : preparePublicationAttempt(publicationState.attempts.publish, {
            fingerprint: attemptFingerprint,
            newIdempotencyKey: createIdempotencyKey(),
          });
    dispatchPublication({ attempt, context, type: "publish-started" });
    setStatus(`Publishing your ${isFork ? "version" : "recipe"}…`);
    try {
      const receipt = await publishRecipeDraft(
        draftId,
        {
          revision: expectedRevision,
          duplicate_review: duplicateReview,
          ...attestations,
        },
        attempt.idempotencyKey,
      );
      dispatchPublication({ attemptId: attempt.idempotencyKey, receipt, type: "published" });
      setStatus(`${isFork ? "Version" : "Recipe"} published. Opening your published recipes…`);
      setBlocked(false);
      router.replace("/account/recipes?view=published");
      router.refresh();
    } catch (reason) {
      finishFailure(reason, "publish", attempt.idempotencyKey);
    }
  }

  async function startReview() {
    if (submitting.current || dirty) return;
    if (!communityRulesAccepted || !contentRightsConfirmed) {
      setConfirmationFailure({
        scope: confirmationScope,
        message: PUBLICATION_CONFIRMATION_MESSAGE,
      });
      window.setTimeout(
        () =>
          (!communityRulesAccepted ? communityRulesRef : contentRightsRef).current?.focus(),
        0,
      );
      return;
    }
    dispatchPublication({ type: "validation-started" });
    const validation = validateRecipeDraftForPublication(
      draft,
      revision,
      measurementUnits,
      actionTypes,
    );
    onValidation(validation);
    if (!validation.payload) {
      dispatchPublication({ type: "validation-failed" });
      return;
    }

    const expectedFingerprint = fingerprint;
    const expectedRevision = revision;
    const attemptFingerprint = `${expectedRevision}:${expectedFingerprint}`;
    const attempt =
      publicationState.attempts.preflight?.fingerprint === attemptFingerprint
        ? publicationState.attempts.preflight
        : preparePublicationAttempt(publicationState.attempts.preflight, {
            fingerprint: attemptFingerprint,
            newIdempotencyKey: createIdempotencyKey(),
          });
    submitting.current = true;
    dispatchPublication({
      attempt,
      scope: { fingerprint: expectedFingerprint, revision: expectedRevision },
      type: "preflight-started",
    });
    setStatus("Checking for similar recipes…");
    setConfirmationFailure(null);
    try {
      const result = await createRecipeDraftDuplicatePreflight(
        draftId,
        expectedRevision,
        attempt.idempotencyKey,
      );
      if (!intentIsCurrent(expectedFingerprint, expectedRevision)) {
        submitting.current = false;
        dispatchPublication({ type: "draft-changed" });
        setStatus("Your draft changed. Save it before checking for similar recipes again.");
        return;
      }
      if (result.classification === "distinct") {
        await publish(
          {
            decision: null,
            result,
            scope: { fingerprint: expectedFingerprint, revision: expectedRevision },
          },
          false,
        );
        return;
      }
      submitting.current = false;
      dispatchPublication({
        attemptId: attempt.idempotencyKey,
        result,
        type: "review-required",
      });
      setStatus("Review the similar recipes before publishing.");
    } catch (reason) {
      finishFailure(reason, "preflight", attempt.idempotencyKey);
    }
  }

  async function continuePublication() {
    if (!activeReview || !activeReview.acknowledged || submitting.current) return;
    submitting.current = true;
    await publish(
      { ...activeReview.review, decision: "continue" },
      failureWorkflow !== null,
    );
  }

  async function retryPublication() {
    if (
      !currentRetryContext ||
      submitting.current ||
      (currentRetryContext.result.classification !== "distinct" && !activeReview?.acknowledged)
    ) {
      return;
    }
    submitting.current = true;
    await publish(currentRetryContext, true);
  }

  function keepEditing() {
    if (pending) return;
    dispatchPublication({ type: "keep-editing" });
    setStatus("Every saved field is ready for you to revise.");
    window.setTimeout(() => document.getElementById("draft-title")?.focus(), 0);
  }

  return (
    <section
      className={`draft-editor__publish-note draft-editor__surface draft-editor__surface--publication draft-publication draft-publication--${isFork ? "fork" : "original"}${activeReview ? " draft-publication--review" : ""}`}
      aria-labelledby="draft-publish-title"
    >
      <p className="eyebrow">Publishing</p>
      <h2 id="draft-publish-title">
        {isFork ? "Publish your version without changing its source." : "Publish this original recipe."}
      </h2>
      {isFork ? (
        <p>
          Publishing creates a separate public version, keeps it based on the recipe you started
          from, and credits you as the author. The starting recipe stays unchanged.
        </p>
      ) : (
        <p>
          Publishing makes this draft a public recipe. Later changes create new versions instead
          of replacing the version people already saw.
        </p>
      )}
      <p className="draft-publication__retention-disclosure">
        Published recipes and their recipe history stay public if you later delete your account.
        Your name is replaced with <strong>Deleted cook</strong>. You can withdraw a recipe from
        My recipes before deleting your account; a withdrawn recipe stays unavailable after the
        account is gone.
      </p>
      <fieldset
        className="draft-publication__requirements"
        aria-describedby={confirmationError ? "draft-publication-confirmation-error" : undefined}
      >
        <legend>Before publishing</legend>
        <div className="draft-publication__requirement">
          <input
            id="draft-publication-community-rules"
            ref={communityRulesRef}
            type="checkbox"
            checked={communityRulesAccepted}
            required
            onChange={(event) => {
              setCommunityRulesConfirmation({
                scope: confirmationScope,
                checked: event.target.checked,
              });
              setConfirmationFailure(null);
            }}
          />
          <div>
            <label htmlFor="draft-publication-community-rules">
              I have read and agree to the community rules.
            </label>{" "}
            <GuardedLink href="/community-rules">Open the community rules</GuardedLink>.
          </div>
        </div>
        <div className="draft-publication__requirement">
          <input
            id="draft-publication-content-rights"
            ref={contentRightsRef}
            type="checkbox"
            checked={contentRightsConfirmed}
            required
            onChange={(event) => {
              setContentRightsConfirmation({
                scope: confirmationScope,
                checked: event.target.checked,
              });
              setConfirmationFailure(null);
            }}
          />
          <label htmlFor="draft-publication-content-rights">
            I created this recipe or have the right to share it.
          </label>
        </div>
      </fieldset>
      {confirmationError ? (
        <p className="form-alert" id="draft-publication-confirmation-error" role="alert">
          {confirmationError}
        </p>
      ) : null}
      {dirty ? <p className="draft-publication__save-first">Save your latest changes before publishing.</p> : null}
      {error ? (
        <div className="form-alert draft-publication__alert" role="alert">
          <h3>{failureHeading}</h3>
          <p>{error}</p>
          <div className="button-row">
            {revisionConflict ? (
              <a
                className="button button--secondary"
                href={`/account/recipe-drafts/${draftId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open latest draft in a new tab
              </a>
            ) : (
              <button
                className="button button--secondary"
                type="button"
                disabled={pending !== null}
                onClick={() => {
                  if (sourceUnavailable) {
                    void startReview();
                  } else if (retryOperation === "publish" && currentRetryContext) {
                    void retryPublication();
                  } else {
                    void startReview();
                  }
                }}
              >
                {sourceUnavailable
                  ? "Check source and retry"
                  : ambiguousPublicationResult
                    ? "Check publication result"
                    : retryOperation === "publish"
                      ? "Try publishing again"
                      : "Check similar recipes again"}
              </button>
            )}
            {!activeReview && !ambiguousPublicationResult && !revisionConflict ? (
              <button
                className="button button--quiet"
                type="button"
                disabled={pending !== null}
                onClick={keepEditing}
              >
                Keep editing
              </button>
            ) : null}
            {sourceUnavailable && sourceVersionId ? (
              <GuardedLink
                className="button button--quiet"
                href={`/recipes/${encodeURIComponent(sourceVersionId)}`}
              >
                Check source page
              </GuardedLink>
            ) : null}
            {sessionExpired ? (
              <a
                className="button button--quiet"
                href={`/sign-in?${new URLSearchParams({ return_to: `/account/recipe-drafts/${draftId}` }).toString()}`}
                target="_blank"
                rel="noreferrer"
              >
                Sign in again in a new tab
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      {activeReview ? (
        <RecipeDuplicatePreflightReview
          mode="publication"
          publicationKind={isFork ? "fork" : "original"}
          result={activeReview.review.result}
          acknowledged={activeReview.acknowledged}
          decisionFailure={null}
          pendingDecision={pending === "publish" ? "continue" : null}
          onAcknowledgedChange={(acknowledged) =>
            dispatchPublication({ acknowledged, type: "acknowledgement-changed" })
          }
          onContinue={() => void continuePublication()}
          onRevise={keepEditing}
          onRetryDecision={() => void continuePublication()}
          onCreateWithoutRecordedDecision={() => undefined}
          onReturnWithoutRecordedDecision={keepEditing}
        />
      ) : !failureWorkflow ? (
        <button
          className="button button--primary"
          type="button"
          disabled={dirty || pending !== null}
          onClick={() => void startReview()}
        >
          {pending === "preflight"
            ? "Checking for similar recipes…"
            : pending === "publish"
              ? `Publishing ${isFork ? "version" : "recipe"}…`
              : isFork
                ? "Review and publish version"
                : "Review and publish"}
        </button>
      ) : null}
      <p className="draft-publication__status" role="status" aria-live="polite">
        {reviewInvalidated
          ? "Your draft changed. Save it before checking for similar recipes again."
          : status || `Only you can publish this saved ${isFork ? "version" : "original recipe"} draft.`}
      </p>
      <p className="draft-publication__boundary">
        Not ready? <GuardedLink href="/account/recipes?view=drafts">Return to your private drafts</GuardedLink>.
      </p>
    </section>
  );
}
