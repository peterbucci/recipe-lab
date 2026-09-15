"use client";

import { useRouter } from "next/navigation";
import {
  type Dispatch,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { isAbortError } from "../../../../shared/api/abort-error";
import { AuthApiError } from "../../../auth/auth-api";
import type { CatalogActionType } from "../../shared/cooking-action-model";
import { createIdempotencyKey } from "../../../../shared/api/idempotency-key";
import type { CatalogUnit } from "../../shared/measurement-unit-model";
import {
  createRecipeDraftDuplicatePreflight,
  RecipeDuplicateApiError,
} from "../duplicate/recipe-duplicate-api";
import {
  duplicateReviewForPublication,
  publishRecipeDraft,
  RecipePublicationApiError,
  type DeclaredChangeReason,
} from "./recipe-publication-api";
import type { RecipeDraftKind } from "../draft/recipe-draft-summary";
import {
  recipeDraftFingerprint,
  recipeDraftFieldErrorsFromIssues,
  type RecipeDraftEditorState,
  type RecipeDraftValidation,
  validateRecipeDraftForPublication,
} from "../draft/recipe-draft";
import {
  preparePublicationAttempt,
  publicationBlocksDismissal,
  publicationContext,
  publicationReview,
  publicationScopeMatches,
  type PublicationContext,
  type PublicationFailureStatus,
  type PublicationScope,
  type RecipeDraftPublicationEvent,
  type RecipeDraftPublicationState,
} from "./recipe-draft-publication-state";
import {
  GuardedLink,
  useNavigationBlocker,
} from "../../../../shared/navigation/navigation-blocker-provider";
import { LoadingButton } from "../../../../shared/ui/loading-ui";
import { BranchIcon } from "../../shared/recipe-action-icons";
import { RecipeDuplicatePreflightReview } from "../duplicate/recipe-duplicate-preflight-review";

interface RecipeDraftPublicationProps {
  actionTypes: readonly CatalogActionType[];
  draft: RecipeDraftEditorState;
  draftId: string;
  draftKind: RecipeDraftKind;
  dirty: boolean;
  measurementUnits: readonly CatalogUnit[];
  onRequestClose?: () => void;
  onValidation: (validation: RecipeDraftValidation) => void;
  publicationDispatch: Dispatch<RecipeDraftPublicationEvent>;
  publicationState: RecipeDraftPublicationState;
  revision: number;
  sourceRecipeId?: string;
  sourceRecipeTitle?: string;
  sourceVersionId: string | null;
}

type PendingOperation = "preflight" | "publish" | null;
type RetryOperation = "preflight" | "publish" | null;

interface PublicationRequest {
  controller: AbortController;
  id: number;
}

const PUBLICATION_CONFIRMATION_MESSAGE =
  "Confirm the community rules and your right to share this recipe before publishing.";

function publicationFailureMessage(
  reason: unknown,
  operation: Exclude<RetryOperation, null>,
  draftKind: RecipeDraftKind,
  kind: PublicationFailureStatus,
): string {
  const publicationSubject =
    draftKind === "revision"
      ? "changes"
      : draftKind === "adaptation"
        ? "version"
        : "recipe";
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
  if (apiError?.code === "recipe_revision_source_stale") {
    return "A newer edition of this recipe was published before your changes. Your private draft is unchanged; review the current recipe before publishing again.";
  }
  if (apiError?.status === 422) {
    return "Some draft fields need attention. Review them before publishing.";
  }
  if (kind === "ambiguous-result") {
    return operation === "publish"
      ? `Recipe Lab did not receive a clear publication result. Your ${publicationSubject} may already be published. Checking this same attempt is safe and cannot create a second publication.`
      : "Recipe Lab did not receive a clear similar-recipes result. Publishing is paused, and your saved draft is still here.";
  }
  return operation === "preflight"
    ? "Similar recipes could not be checked right now. Publishing waits until this check succeeds, and your saved draft is still here."
    : `Recipe Lab could not publish ${draftKind === "revision" ? "these changes" : `this ${publicationSubject}`}. Your saved draft is still here.`;
}

function publicationFailureHeading(
  kind: PublicationFailureStatus,
  operation: Exclude<RetryOperation, null>,
): string {
  if (kind === "authentication-interruption") return "Sign in to continue";
  if (kind === "revision-conflict") return "Review the latest draft";
  if (kind === "source-stale") return "A newer recipe edition is available";
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
    (reason instanceof RecipeDuplicateApiError ||
      reason instanceof RecipePublicationApiError) &&
    reason.code === "recipe_fork_source_unavailable"
  ) {
    return "source-unavailable";
  }
  if (
    (reason instanceof RecipeDuplicateApiError ||
      reason instanceof RecipePublicationApiError) &&
    reason.code === "recipe_revision_source_stale"
  ) {
    return "source-stale";
  }
  if (
    (reason instanceof RecipeDuplicateApiError ||
      reason instanceof RecipePublicationApiError) &&
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
  draftKind,
  dirty,
  measurementUnits,
  onRequestClose,
  onValidation,
  publicationDispatch: dispatchPublication,
  publicationState,
  revision,
  sourceRecipeId,
  sourceRecipeTitle,
  sourceVersionId,
}: RecipeDraftPublicationProps) {
  const router = useRouter();
  const { setBlocked } = useNavigationBlocker();
  const fingerprint = recipeDraftFingerprint(draft);
  const [declaredChangeReason, setDeclaredChangeReason] =
    useState<DeclaredChangeReason>(null);
  const [withdrawPredecessor, setWithdrawPredecessor] = useState(false);
  const currentScope: PublicationScope = {
    declaredChangeReason,
    draftKind,
    fingerprint,
    revision,
    withdrawPredecessor,
  };
  const latestIntent = useRef({ dirty, ...currentScope });
  const nextRequestId = useRef(0);
  const activeRequest = useRef<PublicationRequest | null>(null);
  const publicationConfirmationRef = useRef<HTMLInputElement>(null);
  const confirmationScope = JSON.stringify(currentScope);
  const [publicationConfirmation, setPublicationConfirmation] = useState({
    scope: "",
    checked: false,
  });
  const [confirmationFailure, setConfirmationFailure] = useState<{
    scope: string;
    message: string;
  } | null>(null);
  const publicationConfirmed =
    publicationConfirmation.scope === confirmationScope &&
    publicationConfirmation.checked;
  const confirmationError =
    confirmationFailure?.scope === confirmationScope
      ? confirmationFailure.message
      : "";
  const [status, setStatus] = useState("");
  const isAdaptation = draftKind === "adaptation";
  const isRevision = draftKind === "revision";
  const isVersion = draftKind !== "original";
  const workflow = publicationState.workflow;
  const publicationIntentLocked =
    publicationBlocksDismissal(publicationState);
  const failureWorkflow = workflow.status === "failed" ? workflow : null;
  const pending: PendingOperation =
    workflow.status === "reviewing" && workflow.phase === "checking"
      ? "preflight"
      : workflow.status === "publishing" || workflow.status === "published"
        ? "publish"
        : null;
  const retryOperation: RetryOperation =
    failureWorkflow?.recovery === "source" ||
    failureWorkflow?.recovery === "stale-source"
      ? null
      : failureWorkflow?.recovery === "publish"
        ? "publish"
        : failureWorkflow
          ? "preflight"
          : null;
  const workflowReview = publicationReview(workflow);
  const retryContext = publicationContext(workflow);
  const currentRetryContext =
    retryContext &&
    publicationScopeMatches(retryContext.scope, currentScope, dirty)
      ? retryContext
      : null;
  const activeReview =
    workflowReview &&
    publicationScopeMatches(workflowReview.review.scope, currentScope, dirty)
      ? workflowReview
      : null;
  const reviewInvalidated = workflowReview !== null && activeReview === null;
  const error = failureWorkflow?.message ?? "";
  const failureHeading = failureWorkflow
    ? publicationFailureHeading(
        failureWorkflow.kind,
        failureWorkflow.operation,
      )
    : "";
  const ambiguousPublicationResult =
    failureWorkflow?.kind === "ambiguous-result" &&
    retryOperation === "publish";
  const revisionConflict = failureWorkflow?.kind === "revision-conflict";
  const sessionExpired =
    failureWorkflow?.kind === "authentication-interruption";
  const sourceUnavailable = failureWorkflow?.kind === "source-unavailable";
  const sourceStale = failureWorkflow?.kind === "source-stale";

  useEffect(
    () => () => {
      activeRequest.current?.controller.abort();
      activeRequest.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    latestIntent.current = {
      declaredChangeReason,
      dirty,
      draftKind,
      fingerprint,
      revision,
      withdrawPredecessor,
    };
  }, [
    declaredChangeReason,
    dirty,
    draftKind,
    fingerprint,
    revision,
    withdrawPredecessor,
  ]);

  function beginRequest(): PublicationRequest {
    activeRequest.current?.controller.abort();
    const request = {
      controller: new AbortController(),
      id: ++nextRequestId.current,
    };
    activeRequest.current = request;
    return request;
  }

  function requestIsCurrent(request: PublicationRequest): boolean {
    return (
      activeRequest.current?.id === request.id &&
      !request.controller.signal.aborted
    );
  }

  function finishRequest(request: PublicationRequest): boolean {
    if (!requestIsCurrent(request)) return false;
    activeRequest.current = null;
    return true;
  }

  function intentIsCurrent(expectedScope: PublicationScope): boolean {
    const current = latestIntent.current;
    return (
      !current.dirty &&
      publicationScopeMatches(expectedScope, current, current.dirty)
    );
  }

  function livePublicationAttestations(): {
    community_rules_accepted: true;
    content_rights_confirmed: true;
  } | null {
    if (publicationConfirmationRef.current?.checked !== true) {
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
    activeRequest.current = null;
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
      publicationConfirmationRef.current?.focus();
    }, 0);
  }

  function finishFailure(
    reason: unknown,
    operation: Exclude<RetryOperation, null>,
    attemptId: string,
    request: PublicationRequest,
  ) {
    if (!finishRequest(request)) return;
    const sourceWasUnavailable =
      isVersion &&
      (reason instanceof RecipeDuplicateApiError ||
        reason instanceof RecipePublicationApiError) &&
      reason.status === 409 &&
      reason.code === "recipe_fork_source_unavailable";
    const resetReview =
      (reason instanceof RecipeDuplicateApiError ||
        reason instanceof RecipePublicationApiError) &&
      reason.status === 409;
    const failureKind = sourceWasUnavailable
      ? "source-unavailable"
      : publicationFailureStatus(reason);
    const failureMessage = publicationFailureMessage(
      reason,
      operation,
      draftKind,
      failureKind,
    );
    dispatchPublication({
      attemptId,
      kind: failureKind,
      message: failureMessage,
      operation,
      resetReview,
      type: "operation-failed",
    });
    if (
      reason instanceof RecipePublicationApiError &&
      reason.issues.length > 0
    ) {
      const serverFieldErrors = recipeDraftFieldErrorsFromIssues(
        draft,
        reason.issues,
      );
      onValidation({
        fieldErrors: serverFieldErrors,
        formErrors:
          Object.keys(serverFieldErrors).length > 0 ? [] : [failureMessage],
        payload: null,
      });
    }
    setStatus("");
  }

  async function publish(
    context: PublicationContext,
    preserveExistingFailure: boolean,
  ) {
    const { result, scope, decision } = context;
    const expectedRevision = scope.revision;
    if (!intentIsCurrent(scope)) {
      activeRequest.current = null;
      dispatchPublication({ type: "draft-changed" });
      setStatus("Your draft changed. Save it before publishing.");
      return;
    }
    const attestations = livePublicationAttestations();
    if (!attestations) {
      pauseForMissingPublicationConfirmation(
        JSON.stringify(scope),
        context,
        preserveExistingFailure,
      );
      return;
    }
    const duplicateReview = duplicateReviewForPublication(result, decision);
    const attemptFingerprint = JSON.stringify({
      declared_change_reason: scope.declaredChangeReason,
      duplicate_review: duplicateReview,
      draft_kind: scope.draftKind,
      revision: expectedRevision,
      withdraw_predecessor: scope.withdrawPredecessor,
    });
    const attempt =
      publicationState.attempts.publish?.fingerprint === attemptFingerprint
        ? publicationState.attempts.publish
        : preparePublicationAttempt(publicationState.attempts.publish, {
            fingerprint: attemptFingerprint,
            newIdempotencyKey: createIdempotencyKey(),
          });
    dispatchPublication({ attempt, context, type: "publish-started" });
    setStatus(
      `Publishing your ${isRevision ? "changes" : isAdaptation ? "version" : "recipe"}…`,
    );
    const request = beginRequest();
    try {
      const receipt = await publishRecipeDraft(
        draftId,
        {
          revision: expectedRevision,
          duplicate_review: duplicateReview,
          declared_change_reason: scope.declaredChangeReason,
          withdraw_predecessor: scope.withdrawPredecessor,
          ...attestations,
        },
        attempt.idempotencyKey,
        request.controller.signal,
      );
      if (!finishRequest(request)) return;
      dispatchPublication({
        attemptId: attempt.idempotencyKey,
        receipt,
        type: "published",
      });
      setStatus(
        `${isRevision ? "Changes" : isAdaptation ? "Version" : "Recipe"} published. Opening it…`,
      );
      setBlocked(false);
      router.replace(receipt.location);
      router.refresh();
    } catch (reason) {
      if (
        request.controller.signal.aborted ||
        isAbortError(reason)
      ) {
        return;
      }
      finishFailure(reason, "publish", attempt.idempotencyKey, request);
    }
  }

  async function startReview() {
    if (activeRequest.current || dirty) return;
    if (!publicationConfirmed) {
      setConfirmationFailure({
        scope: confirmationScope,
        message: PUBLICATION_CONFIRMATION_MESSAGE,
      });
      window.setTimeout(() => publicationConfirmationRef.current?.focus(), 0);
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

    const expectedScope = currentScope;
    const expectedRevision = expectedScope.revision;
    const attemptFingerprint = JSON.stringify(expectedScope);
    const attempt =
      publicationState.attempts.preflight?.fingerprint === attemptFingerprint
        ? publicationState.attempts.preflight
        : preparePublicationAttempt(publicationState.attempts.preflight, {
            fingerprint: attemptFingerprint,
            newIdempotencyKey: createIdempotencyKey(),
          });
    dispatchPublication({
      attempt,
      scope: expectedScope,
      type: "preflight-started",
    });
    setStatus("Checking for similar recipes…");
    setConfirmationFailure(null);
    const request = beginRequest();
    try {
      const result = await createRecipeDraftDuplicatePreflight(
        draftId,
        expectedRevision,
        attempt.idempotencyKey,
        request.controller.signal,
      );
      if (!requestIsCurrent(request)) return;
      if (!intentIsCurrent(expectedScope)) {
        finishRequest(request);
        dispatchPublication({ type: "draft-changed" });
        setStatus(
          "Your draft changed. Save it before checking for similar recipes again.",
        );
        return;
      }
      if (result.classification === "distinct") {
        finishRequest(request);
        await publish(
          {
            decision: null,
            result,
            scope: expectedScope,
          },
          false,
        );
        return;
      }
      finishRequest(request);
      dispatchPublication({
        attemptId: attempt.idempotencyKey,
        result,
        type: "review-required",
      });
      setStatus("Review the similar recipes before publishing.");
    } catch (reason) {
      if (
        request.controller.signal.aborted ||
        isAbortError(reason)
      ) {
        return;
      }
      finishFailure(reason, "preflight", attempt.idempotencyKey, request);
    }
  }

  async function continuePublication() {
    if (!activeReview || !activeReview.acknowledged || activeRequest.current)
      return;
    await publish(
      { ...activeReview.review, decision: "continue" },
      failureWorkflow !== null,
    );
  }

  async function retryPublication() {
    if (
      !currentRetryContext ||
      activeRequest.current ||
      (currentRetryContext.result.classification !== "distinct" &&
        !activeReview?.acknowledged)
    ) {
      return;
    }
    await publish(currentRetryContext, true);
  }

  function keepEditing() {
    if (pending) return;
    dispatchPublication({ type: "keep-editing" });
    setStatus("Every saved field is ready for you to revise.");
    if (onRequestClose) {
      onRequestClose();
    } else {
      window.setTimeout(
        () => document.getElementById("draft-title")?.focus(),
        0,
      );
    }
  }

  function changeDeclaredChangeReason(reason: DeclaredChangeReason) {
    if (publicationIntentLocked) return;
    setDeclaredChangeReason(reason);
    if (reason !== "correction") {
      setWithdrawPredecessor(false);
    }
    dispatchPublication({ type: "draft-changed" });
    setStatus("");
  }

  const revisionChangeControls = isRevision ? (
    <fieldset
      className="draft-publication__change-options"
      disabled={publicationIntentLocked}
    >
      <legend>Why are you publishing changes? (optional)</legend>
      <p className="draft-publication__change-help">
        This reason is declared by you and is not independently verified by
        Recipe Lab.
      </p>
      <label className="draft-publication__change-option">
        <input
          checked={declaredChangeReason === null}
          name="draft-publication-change-reason"
          type="radio"
          onChange={() => changeDeclaredChangeReason(null)}
        />
        <span>No change reason</span>
      </label>
      <label className="draft-publication__change-option">
        <input
          checked={declaredChangeReason === "correction"}
          name="draft-publication-change-reason"
          type="radio"
          onChange={() => changeDeclaredChangeReason("correction")}
        />
        <span>I’m correcting a mistake</span>
      </label>
      <label className="draft-publication__change-option">
        <input
          checked={declaredChangeReason === "update"}
          name="draft-publication-change-reason"
          type="radio"
          onChange={() => changeDeclaredChangeReason("update")}
        />
        <span>I’m updating how I make this recipe</span>
      </label>
      {declaredChangeReason === "correction" ? (
        <label className="draft-publication__withdraw-option">
          <input
            checked={withdrawPredecessor}
            type="checkbox"
            onChange={(event) => {
              if (publicationIntentLocked) return;
              setWithdrawPredecessor(event.target.checked);
              dispatchPublication({ type: "draft-changed" });
              setStatus("");
            }}
          />
          <span>
            Withdraw the previous edition when these changes publish. People
            will no longer be able to open that edition.
          </span>
        </label>
      ) : null}
    </fieldset>
  ) : null;

  const publicationConfirmationControl = (
    <>
      <div className="draft-publication__confirmation">
        <input
          id="draft-publication-confirmation"
          ref={publicationConfirmationRef}
          type="checkbox"
          aria-describedby={
            confirmationError
              ? "draft-publication-confirmation-error"
              : undefined
          }
          aria-invalid={confirmationError ? true : undefined}
          checked={publicationConfirmed}
          required
          onChange={(event) => {
            setPublicationConfirmation({
              scope: confirmationScope,
              checked: event.target.checked,
            });
            setConfirmationFailure(null);
          }}
        />
        <label htmlFor="draft-publication-confirmation">
          I have the right to share this recipe and agree to the{" "}
          <GuardedLink href="/community-rules">community rules</GuardedLink>.
        </label>
      </div>
      {confirmationError ? (
        <p
          className="form-alert"
          id="draft-publication-confirmation-error"
          role="alert"
        >
          {confirmationError}
        </p>
      ) : null}
    </>
  );

  return (
    <section
      className={`draft-publication draft-publication--${draftKind}${activeReview ? " draft-publication--review" : ""}`}
      aria-label="Publication details"
    >
      <p
        id="recipe-workspace-finish-summary"
        className="draft-publication__summary"
      >
        {isRevision ? (
          <>Your changes will become the current public edition of this recipe.</>
        ) : (
          <>
            Your {isAdaptation ? "version" : "recipe"} will be public,
            credited to you, and{" "}
            {isAdaptation
              ? "stay linked to the recipe you started from."
              : "start a new recipe family."}
          </>
        )}
      </p>

      {isAdaptation ? (
        <div className="draft-publication__source-summary">
          <span className="draft-publication__source-icon">
            <BranchIcon />
          </span>
          <span>
            Based on{" "}
            <strong>{sourceRecipeTitle || "Source recipe unavailable"}</strong>
            {" · "}the source recipe will not change.
          </span>
        </div>
      ) : null}

      {activeReview ? null : revisionChangeControls}
      {activeReview ? null : publicationConfirmationControl}
      {dirty ? (
        <p className="draft-publication__save-first">
          Save your latest changes before publishing.
        </p>
      ) : null}
      {error ? (
        <div className="form-alert draft-publication__alert" role="alert">
          <h3>{failureHeading}</h3>
          <p>{error}</p>
          <div className="button-row">
            {revisionConflict ? (
              <a
                className="button button--secondary"
                href={`/recipes/drafts/${draftId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open latest draft in a new tab
              </a>
            ) : sourceStale ? (
              sourceRecipeId ? (
                <GuardedLink
                  className="button button--secondary"
                  href={`/recipes/current/${encodeURIComponent(sourceRecipeId)}`}
                >
                  Review the current edition
                </GuardedLink>
              ) : null
            ) : (
              <LoadingButton
                className="button button--secondary"
                type="button"
                pending={pending !== null}
                pendingLabel={
                  pending === "publish"
                    ? `Publishing ${isRevision ? "changes" : isAdaptation ? "version" : "recipe"}…`
                    : sourceUnavailable
                      ? "Checking source…"
                      : ambiguousPublicationResult
                        ? "Checking publication result…"
                        : "Checking similar recipes again…"
                }
                onClick={() => {
                  if (sourceUnavailable) {
                    void startReview();
                  } else if (
                    retryOperation === "publish" &&
                    currentRetryContext
                  ) {
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
              </LoadingButton>
            )}
            {!activeReview &&
            !ambiguousPublicationResult &&
            !revisionConflict ? (
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
                href={`/sign-in?${new URLSearchParams({ return_to: `/recipes/drafts/${draftId}` }).toString()}`}
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
          publicationKind={
            isRevision ? "revision" : isAdaptation ? "fork" : "original"
          }
          confirmationSlot={publicationConfirmationControl}
          result={activeReview.review.result}
          acknowledged={activeReview.acknowledged}
          pendingDecision={pending === "publish" ? "continue" : null}
          onAcknowledgedChange={(acknowledged) =>
            dispatchPublication({
              acknowledged,
              type: "acknowledgement-changed",
            })
          }
          onContinue={() => void continuePublication()}
          onRevise={keepEditing}
        />
      ) : !failureWorkflow ? (
        <div className="draft-publication__actions">
          <LoadingButton
            className="button button--primary"
            type="button"
            aria-label={
              pending === null
                ? isRevision
                  ? "Review and publish changes"
                  : isAdaptation
                  ? "Review and publish version"
                  : "Review and publish"
                : undefined
            }
            disabled={dirty || !publicationConfirmed}
            pending={pending !== null}
            pendingLabel={
              pending === "publish"
                ? `Publishing ${isRevision ? "changes" : isAdaptation ? "version" : "recipe"}…`
                : "Checking for similar recipes…"
            }
            onClick={() => void startReview()}
          >
            Review &amp; publish
          </LoadingButton>
          <button
            className="button button--secondary"
            type="button"
            disabled={pending !== null}
            onClick={keepEditing}
          >
            Keep editing
          </button>
        </div>
      ) : null}
      {pending === null || workflow.status === "published" ? (
        <p
          className={
            reviewInvalidated
              ? "draft-publication__status"
              : "draft-publication__status visually-hidden"
          }
          role="status"
          aria-live="polite"
        >
          {reviewInvalidated
            ? "Your draft changed. Save it before checking for similar recipes again."
            : status ||
              `Only you can publish this saved ${isRevision ? "revision" : isAdaptation ? "version" : "original recipe"} draft.`}
        </p>
      ) : null}
      <p className="draft-publication__fine-print">
        You can withdraw a published {isAdaptation ? "version" : "recipe"}{" "}
        later from My Recipes.
      </p>
    </section>
  );
}
