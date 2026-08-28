"use client";

import { useState } from "react";

import { AuthApiError } from "../../lib/auth-api";
import type { RecipeVisibilityState } from "../../lib/recipe-library-api";
import {
  RecipeVisibilityApiError,
  updateRecipeVisibility,
} from "../../lib/recipe-visibility-api";

interface RecipeVisibilityControlProps {
  onChanged: (state: RecipeVisibilityState) => Promise<void> | void;
  recipeTitle: string;
  recipeVersionId: string;
  state: RecipeVisibilityState;
}

function visibilityErrorMessage(reason: unknown): string {
  if (
    (reason instanceof AuthApiError || reason instanceof RecipeVisibilityApiError) &&
    reason.status === 401
  ) {
    return "Your session expired. Sign in again before changing recipe visibility.";
  }
  if (reason instanceof RecipeVisibilityApiError && reason.status === 404) {
    return "This recipe is no longer available in your account.";
  }
  if (reason instanceof RecipeVisibilityApiError && reason.status === 409) {
    return "This recipe’s visibility changed. Refresh your recipes and try again.";
  }
  return "Recipe Lab could not change this recipe’s public visibility. Try again.";
}

export function RecipeVisibilityControl({
  onChanged,
  recipeTitle,
  recipeVersionId,
  state,
}: RecipeVisibilityControlProps) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const confirmationId = `withdraw-recipe-${recipeVersionId}`;

  async function changeVisibility(nextState: "published" | "author_withdrawn") {
    if (pending) return;
    setPending(true);
    setError("");
    setStatus("");
    try {
      const result = await updateRecipeVisibility(recipeVersionId, nextState);
      setConfirming(false);
      setStatus(
        result.state === "published"
          ? `${recipeTitle} is public again.`
          : `${recipeTitle} is no longer public.`,
      );
      await onChanged(result.state);
    } catch (reason) {
      setError(visibilityErrorMessage(reason));
    } finally {
      setPending(false);
    }
  }

  if (state === "moderation_hidden") {
    return (
      <div className="recipe-visibility-control">
        <p>This recipe is hidden by moderation. Its visibility cannot be changed here.</p>
      </div>
    );
  }

  if (state === "author_withdrawn") {
    return (
      <div className="recipe-visibility-control">
        <p>This recipe is visible only in your recipe library.</p>
        <button
          aria-label={`Restore ${recipeTitle}`}
          className="button button--secondary"
          type="button"
          disabled={pending}
          onClick={() => void changeVisibility("published")}
        >
          {pending ? "Restoring…" : "Restore recipe"}
        </button>
        {error ? <p className="recipe-visibility-control__error" role="alert">{error}</p> : null}
        {status ? <p className="recipe-visibility-control__status" role="status">{status}</p> : null}
      </div>
    );
  }

  return (
    <div className="recipe-visibility-control">
      {!confirming ? (
        <button
          aria-label={`Withdraw ${recipeTitle}`}
          className="button button--quiet"
          type="button"
          aria-expanded="false"
          aria-controls={confirmationId}
          onClick={() => {
            setError("");
            setStatus("");
            setConfirming(true);
          }}
        >
          Withdraw recipe
        </button>
      ) : (
        <div className="recipe-visibility-control__confirmation" id={confirmationId}>
          <p>
            This removes the recipe from public browsing and prevents new activity or versions
            based on it. Existing public versions remain available and show an unavailable source.
          </p>
          <div className="button-row">
            <button
              aria-label={`Confirm withdrawal of ${recipeTitle}`}
              className="button button--danger"
              type="button"
              disabled={pending}
              onClick={() => void changeVisibility("author_withdrawn")}
            >
              {pending ? "Withdrawing…" : "Confirm withdrawal"}
            </button>
            <button
              aria-label={`Cancel withdrawal of ${recipeTitle}`}
              className="button button--quiet"
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error ? <p className="recipe-visibility-control__error" role="alert">{error}</p> : null}
      {status ? <p className="recipe-visibility-control__status" role="status">{status}</p> : null}
    </div>
  );
}
