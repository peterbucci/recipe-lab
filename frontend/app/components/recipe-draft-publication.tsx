"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import type { CatalogActionType } from "../../lib/cooking-action-api";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import type { CatalogUnit } from "../../lib/measurement-unit-api";
import {
  createRecipeDraftDuplicatePreflight,
  RecipeDuplicateApiError,
  type RecipeDuplicatePreflight,
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

interface ReviewState {
  fingerprint: string;
  result: RecipeDuplicatePreflight;
  revision: number;
}

interface Attempt {
  fingerprint: string;
  idempotencyKey: string;
}

type PendingOperation = "preflight" | "publish" | null;
type RetryOperation = "preflight" | "publish" | null;

const PUBLICATION_CONFIRMATION_MESSAGE =
  "Confirm the community rules and your right to share this recipe before publishing.";

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
  const latestIntent = useRef({ dirty, fingerprint, revision });
  const submitting = useRef(false);
  const preflightAttempt = useRef<Attempt | null>(null);
  const publishAttempt = useRef<Attempt | null>(null);
  const communityRulesRef = useRef<HTMLInputElement>(null);
  const contentRightsRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingOperation>(null);
  const [retryOperation, setRetryOperation] = useState<RetryOperation>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
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
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sourceUnavailable, setSourceUnavailable] = useState(false);
  const isFork = sourceVersionId !== null;
  const activeReview =
    review && !dirty && review.fingerprint === fingerprint && review.revision === revision
      ? review
      : null;
  const reviewInvalidated = review !== null && activeReview === null;

  useEffect(() => onBusyChange(pending !== null), [onBusyChange, pending]);

  useEffect(() => {
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

  function pauseForMissingPublicationConfirmation(expectedScope: string) {
    submitting.current = false;
    setPending(null);
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

  function finishFailure(reason: unknown, operation: Exclude<RetryOperation, null>) {
    const sourceWasUnavailable =
      isFork &&
      (reason instanceof RecipeDuplicateApiError || reason instanceof RecipePublicationApiError) &&
      reason.status === 409 &&
      reason.code === "recipe_fork_source_unavailable";
    submitting.current = false;
    setPending(null);
    setRetryOperation(sourceWasUnavailable ? null : operation);
    setSourceUnavailable(sourceWasUnavailable);
    setSessionExpired(
      (reason instanceof RecipeDuplicateApiError || reason instanceof RecipePublicationApiError) &&
        reason.status === 401,
    );
    if (
      (reason instanceof RecipeDuplicateApiError || reason instanceof RecipePublicationApiError) &&
      reason.status === 409
    ) {
      setReview(null);
      setAcknowledged(false);
      setRetryOperation(sourceWasUnavailable ? null : "preflight");
      preflightAttempt.current = null;
      publishAttempt.current = null;
    }
    if (reason instanceof RecipePublicationApiError && reason.issues.length > 0) {
      const serverFieldErrors = recipeDraftFieldErrorsFromIssues(draft, reason.issues);
      onValidation({
        fieldErrors: serverFieldErrors,
        formErrors: Object.keys(serverFieldErrors).length > 0 ? [] : [reason.message],
        payload: null,
      });
    }
    setError(
      reason instanceof RecipeDuplicateApiError || reason instanceof RecipePublicationApiError
        ? reason.message
        : operation === "preflight"
          ? `Recipe Lab could not check this ${isFork ? "version" : "recipe"} right now. Your saved draft is still here.`
          : `Recipe Lab could not publish this ${isFork ? "version" : "recipe"}. Your saved draft is still here.`,
    );
    setStatus("");
  }

  async function publish(
    result: RecipeDuplicatePreflight,
    expectedFingerprint: string,
    expectedRevision: number,
    decision: "continue" | null,
  ) {
    if (!intentIsCurrent(expectedFingerprint, expectedRevision)) {
      submitting.current = false;
      setPending(null);
      setReview(null);
      setAcknowledged(false);
      setStatus("Your draft changed. Save it before publishing.");
      return;
    }
    const attestations = livePublicationAttestations();
    if (!attestations) {
      pauseForMissingPublicationConfirmation(`${expectedRevision}:${expectedFingerprint}`);
      return;
    }
    const duplicateReview = duplicateReviewForPublication(result, decision);
    const attemptFingerprint = JSON.stringify({
      revision: expectedRevision,
      duplicate_review: duplicateReview,
    });
    if (publishAttempt.current?.fingerprint !== attemptFingerprint) {
      publishAttempt.current = {
        fingerprint: attemptFingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }
    setPending("publish");
    setRetryOperation(null);
    setError("");
    setSessionExpired(false);
    setSourceUnavailable(false);
    setStatus(`Publishing one immutable ${isFork ? "version" : "recipe"}…`);
    try {
      const published = await publishRecipeDraft(
        draftId,
        {
          revision: expectedRevision,
          duplicate_review: duplicateReview,
          ...attestations,
        },
        publishAttempt.current.idempotencyKey,
      );
      setStatus(`${isFork ? "Version" : "Recipe"} published. Opening its permanent page…`);
      setBlocked(false);
      router.replace(published.location);
      router.refresh();
    } catch (reason) {
      finishFailure(reason, "publish");
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
    const validation = validateRecipeDraftForPublication(
      draft,
      revision,
      measurementUnits,
      actionTypes,
    );
    onValidation(validation);
    if (!validation.payload) return;

    const expectedFingerprint = fingerprint;
    const expectedRevision = revision;
    const attemptFingerprint = `${expectedRevision}:${expectedFingerprint}`;
    if (preflightAttempt.current?.fingerprint !== attemptFingerprint) {
      preflightAttempt.current = {
        fingerprint: attemptFingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }
    submitting.current = true;
    setPending("preflight");
    setRetryOperation(null);
    setReview(null);
    setAcknowledged(false);
    setError("");
    setSessionExpired(false);
    setSourceUnavailable(false);
    setStatus("Checking this saved recipe’s structure…");
    setConfirmationFailure(null);
    try {
      const result = await createRecipeDraftDuplicatePreflight(
        draftId,
        expectedRevision,
        preflightAttempt.current.idempotencyKey,
      );
      if (!intentIsCurrent(expectedFingerprint, expectedRevision)) {
        submitting.current = false;
        setPending(null);
        setStatus("Your draft changed. Save it before checking the structure again.");
        return;
      }
      if (result.classification === "distinct") {
        await publish(result, expectedFingerprint, expectedRevision, null);
        return;
      }
      submitting.current = false;
      setPending(null);
      setReview({ result, fingerprint: expectedFingerprint, revision: expectedRevision });
      setStatus("Review the advisory recipe matches before publishing.");
    } catch (reason) {
      finishFailure(reason, "preflight");
    }
  }

  async function continuePublication() {
    if (!activeReview || !acknowledged || submitting.current) return;
    submitting.current = true;
    await publish(
      activeReview.result,
      activeReview.fingerprint,
      activeReview.revision,
      "continue",
    );
  }

  function keepEditing() {
    if (pending) return;
    setReview(null);
    setAcknowledged(false);
    setRetryOperation(null);
    setError("");
    setStatus("Every saved field is ready for you to revise.");
    publishAttempt.current = null;
    window.setTimeout(() => document.getElementById("draft-title")?.focus(), 0);
  }

  return (
    <section className="draft-editor__publish-note draft-publication" aria-labelledby="draft-publish-title">
      <p className="eyebrow">Publishing</p>
      <h2 id="draft-publish-title">
        {isFork ? "Publish your version without changing its source." : "Publish this original recipe."}
      </h2>
      {isFork ? (
        <p>
          Publication creates a separate immutable child in the source recipe’s lineage. It keeps
          this draft’s exact direct parent and credits you as the author; the source stays unchanged.
        </p>
      ) : (
        <p>
          Publication creates one public root recipe and an immutable version 1. Later corrections
          become new versions; they never rewrite this snapshot.
        </p>
      )}
      <p className="draft-publication__retention-disclosure">
        Published snapshots and their recipe lineage stay public if you later delete your account.
        Your name is replaced with <strong>Deleted cook</strong>. You can withdraw a snapshot from
        My recipes before deleting your account; a withdrawn snapshot stays unavailable after the
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
          <p>{error}</p>
          <div className="button-row">
            <button
              className="button button--secondary"
              type="button"
              disabled={pending !== null}
              onClick={() => {
                if (sourceUnavailable) {
                  void startReview();
                } else if (retryOperation === "publish" && activeReview) {
                  void continuePublication();
                } else {
                  void startReview();
                }
              }}
            >
              {sourceUnavailable
                ? "Check source and retry"
                : retryOperation === "publish" && activeReview
                  ? "Retry publication"
                  : "Retry similarity review"}
            </button>
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
          result={activeReview.result}
          acknowledged={acknowledged}
          decisionFailure={null}
          pendingDecision={pending === "publish" ? "continue" : null}
          onAcknowledgedChange={setAcknowledged}
          onContinue={() => void continuePublication()}
          onRevise={keepEditing}
          onRetryDecision={() => void continuePublication()}
          onCreateWithoutRecordedDecision={() => undefined}
          onReturnWithoutRecordedDecision={keepEditing}
        />
      ) : (
        <button
          className="button button--primary"
          type="button"
          disabled={dirty || pending !== null}
          onClick={() => void startReview()}
        >
          {pending === "preflight"
            ? "Checking recipe structure…"
            : pending === "publish"
              ? `Publishing ${isFork ? "version" : "recipe"}…`
              : isFork
                ? "Review and publish version"
                : "Review and publish"}
        </button>
      )}
      <p className="draft-publication__status" role="status" aria-live="polite">
        {reviewInvalidated
          ? "Your draft changed. Save it before checking the recipe structure again."
          : status || `Only you can publish this saved ${isFork ? "fork" : "original"} draft.`}
      </p>
      <p className="draft-publication__boundary">
        Not ready? <GuardedLink href="/account/recipe-drafts">Return to your private drafts</GuardedLink>.
      </p>
    </section>
  );
}
