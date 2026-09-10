"use client";

import { useEffect, useRef, useState } from "react";

import { AuthApiError } from "../../auth/auth-api";
import type { RecipeVisibilityState } from "./recipe-library-model";
import {
  RecipeVisibilityApiError,
  updateRecipeVisibility,
} from "./recipe-visibility-api";
import { LoadingButton } from "../../../shared/ui/loading-ui";

interface RecipeVisibilityControlProps {
  onChanged: (state: RecipeVisibilityState) => Promise<void> | void;
  recipeTitle: string;
  recipeVersionId: string;
  state: RecipeVisibilityState;
}

function visibilityErrorMessage(reason: unknown): string {
  if (
    (reason instanceof AuthApiError ||
      reason instanceof RecipeVisibilityApiError) &&
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const confirmationButtonRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const confirmationId = `withdraw-recipe-${recipeVersionId}`;

  useEffect(() => {
    if (confirming) {
      confirmationButtonRef.current?.focus();
    } else if (returnFocus.current) {
      returnFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [confirming]);

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
    return null;
  }

  if (state === "author_withdrawn") {
    return (
      <div className="recipe-visibility-control">
        <LoadingButton
          aria-label={pending ? `Restoring ${recipeTitle}…` : `Restore ${recipeTitle}`}
          className="button button--secondary"
          type="button"
          pending={pending}
          pendingLabel="Restoring…"
          onClick={() => void changeVisibility("published")}
        >
          Restore to public
        </LoadingButton>
        {error ? (
          <p className="recipe-visibility-control__error" role="alert">
            {error}
          </p>
        ) : null}
        {status ? (
          <p className="recipe-visibility-control__status" role="status">
            {status}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="recipe-visibility-control">
      {!confirming ? (
        <button
          ref={triggerRef}
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
        <div
          className="recipe-visibility-control__confirmation"
          id={confirmationId}
        >
          <p>
            This removes the recipe from public browsing and prevents new
            activity or versions based on it. Existing public versions remain
            available and show an unavailable source.
          </p>
          <div className="button-row">
            <LoadingButton
              ref={confirmationButtonRef}
              aria-label={
                pending
                  ? `Withdrawing ${recipeTitle}…`
                  : `Confirm withdrawal of ${recipeTitle}`
              }
              className="button button--danger"
              type="button"
              pending={pending}
              pendingLabel="Withdrawing…"
              onClick={() => void changeVisibility("author_withdrawn")}
            >
              Confirm withdrawal
            </LoadingButton>
            <button
              aria-label={`Cancel withdrawal of ${recipeTitle}`}
              className="button button--quiet"
              type="button"
              disabled={pending}
              onClick={() => {
                returnFocus.current = true;
                setConfirming(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {error ? (
        <p className="recipe-visibility-control__error" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="recipe-visibility-control__status" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
