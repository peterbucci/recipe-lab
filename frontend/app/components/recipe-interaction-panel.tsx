"use client";

import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

import { createIdempotencyKey } from "../../lib/idempotency-key";
import {
  clearRecipeRating,
  type RatingValue,
  type RecipeViewerState,
  setRecipeRating,
  setRecipeSaved,
} from "../../lib/interaction-api";
import { LoadingButton } from "./loading-ui";
import { HeartIcon, StarIcon } from "./recipe-action-icons";

interface RecipeInteractionPanelProps {
  initialViewerState: RecipeViewerState;
  onSavedChange?: (saved: boolean, previouslySaved: boolean) => void;
  primaryAction: ReactNode;
}

interface ActionAttempt {
  fingerprint: string;
  idempotencyKey: string;
}

const RATING_OPTIONS: ReadonlyArray<{ rating: RatingValue; label: string }> = [
  { rating: 1, label: "Not for me" },
  { rating: 2, label: "Okay" },
  { rating: 3, label: "Good" },
  { rating: 4, label: "Really good" },
  { rating: 5, label: "Loved it" },
];

function isUnauthorized(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "status" in reason &&
    reason.status === 401
  );
}

export function RecipeInteractionPanel({
  initialViewerState,
  onSavedChange,
  primaryAction,
}: RecipeInteractionPanelProps) {
  const router = useRouter();
  const contextId = useId();
  const ratingDialogId = useId();
  const ratingTitleId = useId();
  const saveAttemptRef = useRef<ActionAttempt | null>(null);
  const ratingAttemptRef = useRef<ActionAttempt | null>(null);
  const rateControlRef = useRef<HTMLDivElement>(null);
  const rateButtonRef = useRef<HTMLButtonElement>(null);
  const starButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const successTimerRef = useRef<number | null>(null);
  const [viewerState, setViewerState] = useState(initialViewerState);
  const [savePending, setSavePending] = useState(false);
  const [ratingPending, setRatingPending] = useState(false);
  const [ratingOpen, setRatingOpen] = useState(false);
  const [previewRating, setPreviewRating] = useState<RatingValue | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [ratingMessage, setRatingMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [ratingError, setRatingError] = useState("");
  const interactionPending = savePending || ratingPending;

  useEffect(() => {
    return () => {
      if (successTimerRef.current !== null)
        window.clearTimeout(successTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ratingOpen) return;

    function closeFromOutside(event: PointerEvent) {
      if (!rateControlRef.current?.contains(event.target as Node)) {
        setRatingOpen(false);
        setPreviewRating(null);
      }
    }

    function closeFromKeyboard(event: KeyboardEvent) {
      if (event.key === "Escape" && !ratingPending) {
        setRatingOpen(false);
        setPreviewRating(null);
        rateButtonRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [ratingOpen, ratingPending]);

  const displayedRating = previewRating ?? viewerState.rating ?? 0;
  const displayedLabel =
    RATING_OPTIONS.find((option) => option.rating === displayedRating)?.label ??
    "Tap a star to rate";

  function openRating() {
    setRatingOpen(true);
    setRatingMessage("");
    setRatingError("");
    setPreviewRating(viewerState.rating);
    const focusIndex = viewerState.rating === null ? 0 : viewerState.rating - 1;
    window.setTimeout(() => starButtonRefs.current[focusIndex]?.focus(), 0);
  }

  function closeRating() {
    if (ratingPending) return;
    setRatingOpen(false);
    setPreviewRating(null);
    rateButtonRef.current?.focus();
  }

  function closeAfterSuccess() {
    if (successTimerRef.current !== null)
      window.clearTimeout(successTimerRef.current);
    successTimerRef.current = window.setTimeout(() => {
      setRatingOpen(false);
      setPreviewRating(null);
      setRatingMessage("");
      rateButtonRef.current?.focus();
      successTimerRef.current = null;
    }, 650);
  }

  async function handleSaveToggle() {
    if (interactionPending) return;

    const nextSaved = !viewerState.saved;
    setSavePending(true);
    setSaveMessage("");
    setSaveError("");

    const fingerprint = `${viewerState.recipe_version_id}:saved:${nextSaved}`;
    if (saveAttemptRef.current?.fingerprint !== fingerprint) {
      saveAttemptRef.current = {
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }

    try {
      const updatedState = await setRecipeSaved(
        viewerState.recipe_version_id,
        nextSaved,
        saveAttemptRef.current.idempotencyKey,
      );
      onSavedChange?.(updatedState.saved, viewerState.saved);
      setViewerState(updatedState);
      setSaveMessage(
        updatedState.saved
          ? "Saved to your account."
          : "Removed from your saved recipes.",
      );
    } catch (reason) {
      setSaveError(
        isUnauthorized(reason)
          ? "Your session expired. Sign in again to continue."
          : "We couldn’t change your saved recipes. Your previous state is unchanged.",
      );
    } finally {
      setSavePending(false);
    }
  }

  async function saveRating(rating: RatingValue) {
    if (interactionPending) return;

    setRatingPending(true);
    setRatingMessage("");
    setRatingError("");
    setPreviewRating(rating);

    const fingerprint = `${viewerState.recipe_version_id}:rating:${rating}`;
    if (ratingAttemptRef.current?.fingerprint !== fingerprint) {
      ratingAttemptRef.current = {
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }

    try {
      const updatedState = await setRecipeRating(
        viewerState.recipe_version_id,
        rating,
        ratingAttemptRef.current.idempotencyKey,
      );
      setViewerState(updatedState);
      setPreviewRating(updatedState.rating);
      setRatingMessage(`✓ Rated ${rating} ${rating === 1 ? "star" : "stars"}`);
      router.refresh();
      closeAfterSuccess();
    } catch (reason) {
      setPreviewRating(viewerState.rating);
      setRatingError(
        isUnauthorized(reason)
          ? "Your session expired. Sign in again to continue."
          : "We couldn’t update your rating. Your previous rating is unchanged.",
      );
    } finally {
      setRatingPending(false);
    }
  }

  async function removeRating() {
    if (interactionPending || viewerState.rating === null) return;

    setRatingPending(true);
    setRatingMessage("");
    setRatingError("");

    const fingerprint = `${viewerState.recipe_version_id}:rating:remove`;
    if (ratingAttemptRef.current?.fingerprint !== fingerprint) {
      ratingAttemptRef.current = {
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }

    try {
      const updatedState = await clearRecipeRating(
        viewerState.recipe_version_id,
        ratingAttemptRef.current.idempotencyKey,
      );
      setViewerState(updatedState);
      setPreviewRating(null);
      setRatingMessage("✓ Rating removed");
      router.refresh();
      closeAfterSuccess();
    } catch (reason) {
      setPreviewRating(viewerState.rating);
      setRatingError(
        isUnauthorized(reason)
          ? "Your session expired. Sign in again to continue."
          : "We couldn’t remove your rating. Your previous rating is unchanged.",
      );
    } finally {
      setRatingPending(false);
    }
  }

  return (
    <section
      className="recipe-interactions"
      aria-label="Save and rate this recipe"
    >
      <p id={contextId} className="visually-hidden">
        Saves and ratings are specific to your account.
      </p>
      <div className="recipe-action-strip">
        <LoadingButton
          className="recipe-action-button recipe-action-button--save"
          type="button"
          aria-describedby={contextId}
          aria-label={
            savePending
              ? viewerState.saved
                ? "Removing saved recipe…"
                : "Saving recipe…"
              : viewerState.saved
                ? "Remove saved recipe"
                : "Save recipe"
          }
          aria-pressed={viewerState.saved}
          disabled={ratingPending}
          pending={savePending}
          pendingLabel={viewerState.saved ? "Removing…" : "Saving…"}
          onClick={() => void handleSaveToggle()}
        >
          <HeartIcon filled={viewerState.saved} />
          <span>Save</span>
        </LoadingButton>

        <div className="recipe-rate-control" ref={rateControlRef}>
          <button
            ref={rateButtonRef}
            className="recipe-action-button recipe-action-button--rate"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={ratingOpen}
            aria-controls={ratingDialogId}
            aria-label={
              viewerState.rating === null
                ? "Rate recipe"
                : `Change rating, currently ${viewerState.rating} ${viewerState.rating === 1 ? "star" : "stars"}`
            }
            onClick={ratingOpen ? closeRating : openRating}
          >
            <StarIcon filled={viewerState.rating !== null} />
            <span>{viewerState.rating ?? "Rate"}</span>
          </button>

          {ratingOpen ? (
            <section
              id={ratingDialogId}
              className="recipe-rating-popover"
              role="dialog"
              aria-modal="false"
              aria-labelledby={ratingTitleId}
              aria-busy={ratingPending}
            >
              <h2 id={ratingTitleId}>
                {viewerState.rating === null
                  ? "How would you rate this?"
                  : "Your rating"}
              </h2>
              <div
                className="recipe-rating-stars"
                aria-label="Choose a rating"
                onMouseLeave={() => setPreviewRating(viewerState.rating)}
              >
                {RATING_OPTIONS.map((option, index) => (
                  <LoadingButton
                    compact
                    key={option.rating}
                    ref={(element) => {
                      starButtonRefs.current[index] = element;
                    }}
                    className={
                      option.rating <= displayedRating ? "is-filled" : undefined
                    }
                    type="button"
                    aria-label={
                      ratingPending && previewRating === option.rating
                        ? `Saving ${option.rating} ${option.rating === 1 ? "star" : "stars"}…`
                        : `${option.rating} ${option.rating === 1 ? "star" : "stars"} — ${option.label}`
                    }
                    aria-pressed={viewerState.rating === option.rating}
                    disabled={ratingPending}
                    pending={
                      ratingPending && previewRating === option.rating
                    }
                    pendingLabel={`Saving ${option.rating} ${option.rating === 1 ? "star" : "stars"}…`}
                    onFocus={() => setPreviewRating(option.rating)}
                    onMouseEnter={() => setPreviewRating(option.rating)}
                    onClick={() => void saveRating(option.rating)}
                  >
                    <StarIcon filled={option.rating <= displayedRating} />
                    <span aria-hidden="true">{option.rating}</span>
                  </LoadingButton>
                ))}
              </div>
              <p className="recipe-rating-popover__label" aria-live="polite">
                {ratingMessage || displayedLabel}
              </p>
              {ratingError ? (
                <p className="recipe-rating-popover__error" role="alert">
                  {ratingError}
                </p>
              ) : null}
              <div className="recipe-rating-popover__actions">
                {viewerState.rating !== null ? (
                  <LoadingButton
                    className="recipe-rating-popover__remove"
                    type="button"
                    pending={ratingPending && previewRating === null}
                    pendingLabel="Removing rating…"
                    onClick={() => void removeRating()}
                  >
                    Remove rating
                  </LoadingButton>
                ) : null}
                <button
                  type="button"
                  disabled={ratingPending}
                  onClick={closeRating}
                >
                  Cancel
                </button>
              </div>
            </section>
          ) : null}
        </div>

        {primaryAction}
      </div>

      <div className="recipe-interaction-feedback" aria-live="polite">
        {saveMessage ? <p>{saveMessage}</p> : null}
        {saveError ? <p role="alert">{saveError}</p> : null}
      </div>
    </section>
  );
}
