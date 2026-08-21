"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useId, useState } from "react";

import {
  type RatingValue,
  type RecipeViewerState,
  setRecipeRating,
  setRecipeSaved,
} from "../../lib/interaction-api";

interface RecipeInteractionPanelProps {
  initialViewerState: RecipeViewerState;
}

const RATING_OPTIONS: RatingValue[] = [1, 2, 3, 4, 5];

export function RecipeInteractionPanel({
  initialViewerState,
}: RecipeInteractionPanelProps) {
  const router = useRouter();
  const headingId = useId();
  const contextId = useId();
  const saveStatusId = useId();
  const ratingStatusId = useId();
  const [viewerState, setViewerState] = useState(initialViewerState);
  const [selectedRating, setSelectedRating] = useState<RatingValue | null>(
    initialViewerState.rating,
  );
  const [savePending, setSavePending] = useState(false);
  const [ratingPending, setRatingPending] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [ratingMessage, setRatingMessage] = useState("");
  const [saveError, setSaveError] = useState("");
  const [ratingError, setRatingError] = useState("");
  const interactionPending = savePending || ratingPending;

  const saveButtonText = savePending
    ? viewerState.saved
      ? "Removing…"
      : "Saving…"
    : viewerState.saved
      ? "Remove saved recipe"
      : "Save recipe";
  const ratingChanged = selectedRating !== null && selectedRating !== viewerState.rating;

  async function handleSaveToggle() {
    if (interactionPending) {
      return;
    }

    const nextSaved = !viewerState.saved;
    setSavePending(true);
    setSaveMessage("");
    setSaveError("");

    try {
      const updatedState = await setRecipeSaved(viewerState.recipe_version_id, nextSaved);
      setViewerState(updatedState);
      setSaveMessage(
        updatedState.saved
          ? `Saved to ${updatedState.user.display_name}.`
          : `Removed from ${updatedState.user.display_name}'s saved recipes.`,
      );
    } catch {
      setSaveError(
        nextSaved
          ? "We couldn’t save this recipe. Your previous state is unchanged."
          : "We couldn’t remove this saved recipe. Your previous state is unchanged.",
      );
    } finally {
      setSavePending(false);
    }
  }

  async function handleRatingSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (interactionPending || !ratingChanged || selectedRating === null) {
      return;
    }

    setRatingPending(true);
    setRatingMessage("");
    setRatingError("");

    try {
      const updatedState = await setRecipeRating(
        viewerState.recipe_version_id,
        selectedRating,
      );
      setViewerState(updatedState);
      setSelectedRating(updatedState.rating);
      setRatingMessage(
        `Your rating is now ${updatedState.rating} out of 5 for ${updatedState.user.display_name}.`,
      );
      router.refresh();
    } catch {
      setRatingError("We couldn’t update your rating. Your previous rating is unchanged.");
    } finally {
      setRatingPending(false);
    }
  }

  return (
    <section className="recipe-interactions" aria-labelledby={headingId}>
      <div className="recipe-interactions__header">
        <div>
          <p className="eyebrow">Shared demo profile</p>
          <h2 id={headingId}>Your demo activity</h2>
          <p id={contextId} className="recipe-interactions__context">
            <strong>{viewerState.user.display_name}</strong> · Saves and ratings are shared
            across this demo.
          </p>
        </div>
        <div className="recipe-interactions__save">
          <button
            className="button button--secondary interaction-save-button"
            type="button"
            aria-busy={savePending}
            aria-describedby={`${contextId} ${saveStatusId}`}
            aria-label={viewerState.saved ? "Remove saved recipe" : "Save recipe"}
            aria-pressed={viewerState.saved}
            disabled={interactionPending}
            onClick={handleSaveToggle}
          >
            {saveButtonText}
          </button>
          <p id={saveStatusId} className="interaction-feedback" role="status" aria-live="polite">
            {saveMessage}
          </p>
          {saveError ? (
            <p className="interaction-feedback interaction-feedback--error" role="alert">
              {saveError}
            </p>
          ) : null}
        </div>
      </div>

      <form className="recipe-rating-form" aria-busy={ratingPending} onSubmit={handleRatingSubmit}>
        <fieldset disabled={interactionPending}>
          <legend>Your rating</legend>
          <div className="recipe-rating-options">
            {RATING_OPTIONS.map((rating) => (
              <label key={rating} className="recipe-rating-option">
                <input
                  type="radio"
                  name="rating"
                  value={rating}
                  aria-label={`${rating} ${rating === 1 ? "star" : "stars"}`}
                  checked={selectedRating === rating}
                  onChange={() => setSelectedRating(rating)}
                />
                <span aria-hidden="true">{rating}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <p className="recipe-rating-form__current">
          {viewerState.rating === null
            ? "You haven’t rated this recipe yet."
            : `Your current rating is ${viewerState.rating} out of 5.`}
        </p>
        <button
          className="button button--primary"
          type="submit"
          aria-describedby={`${contextId} ${ratingStatusId}`}
          disabled={!ratingChanged || interactionPending}
        >
          {ratingPending
            ? "Updating…"
            : viewerState.rating === null
              ? "Rate recipe"
              : "Update rating"}
        </button>
        <div className="recipe-rating-form__feedback">
          <p
            id={ratingStatusId}
            className="interaction-feedback"
            role="status"
            aria-live="polite"
          >
            {ratingMessage}
          </p>
          {ratingError ? (
            <p className="interaction-feedback interaction-feedback--error" role="alert">
              {ratingError}
            </p>
          ) : null}
        </div>
      </form>
    </section>
  );
}
