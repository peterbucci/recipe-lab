"use client";

import { useRouter } from "next/navigation";
import {
  type Dispatch,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

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
  preparePublicationAttempt,
  publicationContext,
  publicationReview,
  publicationScopeMatches,
  type PublicationContext,
  type PublicationFailureStatus,
  type PublicationScope,
  type RecipeDraftPublicationEvent,
  type RecipeDraftPublicationState,
} from "../../lib/recipe-draft-publication-state";
import {
  GuardedLink,
  useNavigationBlocker,
} from "./navigation-blocker-provider";
import { LoadingButton } from "./loading-ui";
import { BranchIcon } from "./recipe-action-icons";
import { RecipeDuplicatePreflightReview } from "./recipe-duplicate-preflight-review";

interface RecipeDraftPublicationProps {
  actionTypes: readonly CatalogActionType[];
  draft: RecipeDraftEditorState;
  draftId: string;
  dirty: boolean;
  measurementUnits: readonly CatalogUnit[];
  onRequestClose?: () => void;
  onValidation: (validation: RecipeDraftValidation) => void;
  publicationDispatch: Dispatch<RecipeDraftPublicationEvent>;
  publicationState: RecipeDraftPublicationState;
  revision: number;
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
    (reason instanceof RecipeDuplicateApiError ||
      reason instanceof RecipePublicationApiError) &&
    reason.code === "recipe_fork_source_unavailable"
  ) {
    return "source-unavailable";
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
  dirty,
  measurementUnits,
  onRequestClose,
  onValidation,
  publicationDispatch: dispatchPublication,
  publicationState,
  revision,
  sourceRecipeTitle,
  sourceVersionId,
}: RecipeDraftPublicationProps) {
  const router = useRouter();
  const { setBlocked } = useNavigationBlocker();
  const fingerprint = recipeDraftFingerprint(draft);
  const currentScope: PublicationScope = { fingerprint, revision };
  const latestIntent = useRef({ dirty, fingerprint, revision });
  const nextRequestId = useRef(0);
  const activeRequest = useRef<PublicationRequest | null>(null);
  const publicationConfirmationRef = useRef<HTMLInputElement>(null);
  const confirmationScope = `${revision}:${fingerprint}`;
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
  const isFork = sourceVersionId !== null;
  const workflow = publicationState.workflow;
  const failureWorkflow = workflow.status === "failed" ? workflow : null;
  const pending: PendingOperation =
    workflow.status === "reviewing" && workflow.phase === "checking"
      ? "preflight"
      : workflow.status === "publishing" || workflow.status === "published"
        ? "publish"
        : null;
  const retryOperation: RetryOperation =
    failureWorkflow?.recovery === "source"
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

  useEffect(
    () => () => {
      activeRequest.current?.controller.abort();
      activeRequest.current = null;
    },
    [],
  );

  useLayoutEffect(() => {
    latestIntent.current = { dirty, fingerprint, revision };
  }, [dirty, fingerprint, revision]);

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

  function intentIsCurrent(
    expectedFingerprint: string,
    expectedRevision: number,
  ): boolean {
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
      isFork &&
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
      isFork,
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
    const expectedFingerprint = scope.fingerprint;
    const expectedRevision = scope.revision;
    if (!intentIsCurrent(expectedFingerprint, expectedRevision)) {
      activeRequest.current = null;
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
    const request = beginRequest();
    try {
      const receipt = await publishRecipeDraft(
        draftId,
        {
          revision: expectedRevision,
          duplicate_review: duplicateReview,
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
      setStatus(`${isFork ? "Version" : "Recipe"} published. Opening it…`);
      setBlocked(false);
      router.replace(receipt.location);
      router.refresh();
    } catch (reason) {
      if (
        request.controller.signal.aborted ||
        (reason instanceof DOMException && reason.name === "AbortError")
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
    dispatchPublication({
      attempt,
      scope: { fingerprint: expectedFingerprint, revision: expectedRevision },
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
      if (!intentIsCurrent(expectedFingerprint, expectedRevision)) {
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
            scope: {
              fingerprint: expectedFingerprint,
              revision: expectedRevision,
            },
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
        (reason instanceof DOMException && reason.name === "AbortError")
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
      className={`draft-publication draft-publication--${isFork ? "fork" : "original"}${activeReview ? " draft-publication--review" : ""}`}
      aria-label="Publication details"
    >
      <p
        id="recipe-workspace-finish-summary"
        className="draft-publication__summary"
      >
        Your {isFork ? "version" : "recipe"} will be public, credited to you,
        and{" "}
        {isFork
          ? "stay linked to the recipe you started from."
          : "start a new recipe family."}
      </p>

      {isFork ? (
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
            ) : (
              <LoadingButton
                className="button button--secondary"
                type="button"
                pending={pending !== null}
                pendingLabel={
                  pending === "publish"
                    ? `Publishing ${isFork ? "version" : "recipe"}…`
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
          mode="publication"
          publicationKind={isFork ? "fork" : "original"}
          confirmationSlot={publicationConfirmationControl}
          result={activeReview.review.result}
          acknowledged={activeReview.acknowledged}
          decisionFailure={null}
          pendingDecision={pending === "publish" ? "continue" : null}
          onAcknowledgedChange={(acknowledged) =>
            dispatchPublication({
              acknowledged,
              type: "acknowledgement-changed",
            })
          }
          onContinue={() => void continuePublication()}
          onRevise={keepEditing}
          onRetryDecision={() => void continuePublication()}
          onCreateWithoutRecordedDecision={() => undefined}
          onReturnWithoutRecordedDecision={keepEditing}
        />
      ) : !failureWorkflow ? (
        <div className="draft-publication__actions">
          <LoadingButton
            className="button button--primary"
            type="button"
            aria-label={
              pending === null
                ? isFork
                  ? "Review and publish version"
                  : "Review and publish"
                : undefined
            }
            disabled={dirty || !publicationConfirmed}
            pending={pending !== null}
            pendingLabel={
              pending === "publish"
                ? `Publishing ${isFork ? "version" : "recipe"}…`
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
              `Only you can publish this saved ${isFork ? "version" : "original recipe"} draft.`}
        </p>
      ) : null}
      <p className="draft-publication__fine-print">
        You can withdraw a published {isFork ? "version" : "recipe"} later from
        My Recipes.
      </p>
    </section>
  );
}
