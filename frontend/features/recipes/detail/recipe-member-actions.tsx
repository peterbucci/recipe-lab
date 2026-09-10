"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";

import { isAbortError } from "../../../shared/api/abort-error";
import {
  fetchRecipeViewerState,
  type RecipeViewerState,
} from "./interaction-api";
import { useAuthSession } from "../../auth/auth-session-provider";
import { InlineLoading, LoadingButton } from "../../../shared/ui/loading-ui";
import { RatingSummary } from "../shared/rating-summary";
import { BranchIcon, HeartIcon, StarIcon } from "../shared/recipe-action-icons";
import { RecipeInteractionPanel } from "./recipe-interaction-panel";
import { RecipeViewTracker } from "./recipe-view-tracker";

export interface RecipeEditActionState {
  errorMessage: string | null;
  hasActiveDraft: boolean;
  pending: boolean;
}

interface RecipeMemberActionsProps {
  averageRating: number | null;
  editAction: RecipeEditActionState;
  onRequestEdit: () => void;
  ratingCount: number;
  recipeVersionId: string;
  saveCount: number;
}

type PrivateState =
  | { phase: "idle" }
  | { phase: "ready"; ownerId: string; viewerState: RecipeViewerState }
  | { phase: "error"; ownerId: string };

type AuthPrompt = "rate" | "save" | null;

function accountHref(
  path: "/onboarding" | "/sign-in",
  returnTo: string,
): string {
  return `${path}?${new URLSearchParams({ return_to: returnTo }).toString()}`;
}

interface SignedOutToolbarProps {
  primaryAction: ReactNode;
  onPrompt: (prompt: Exclude<AuthPrompt, null>) => void;
}

function SignedOutToolbar({ primaryAction, onPrompt }: SignedOutToolbarProps) {
  return (
    <div className="recipe-action-strip" aria-label="Recipe actions">
      <button
        className="recipe-action-button recipe-action-button--save"
        type="button"
        aria-label="Save recipe"
        onClick={() => onPrompt("save")}
      >
        <HeartIcon />
        <span>Save</span>
      </button>
      <button
        className="recipe-action-button recipe-action-button--rate"
        type="button"
        aria-haspopup="dialog"
        aria-label="Rate recipe"
        onClick={() => onPrompt("rate")}
      >
        <StarIcon />
        <span>Rate</span>
      </button>
      {primaryAction}
    </div>
  );
}

export function RecipeMemberActions({
  averageRating,
  editAction,
  onRequestEdit,
  ratingCount,
  recipeVersionId,
  saveCount,
}: RecipeMemberActionsProps) {
  const { state: authState, refreshSession } = useAuthSession();
  const returnTo = `/recipes/${encodeURIComponent(recipeVersionId)}`;
  const forkHref = `${returnTo}/fork`;
  const [privateState, setPrivateState] = useState<PrivateState>({
    phase: "idle",
  });
  const [retryCount, setRetryCount] = useState(0);
  const [authPrompt, setAuthPrompt] = useState<AuthPrompt>(null);
  const [displayedSaveCount, setDisplayedSaveCount] = useState(saveCount);

  const memberId =
    authState.phase === "ready" && authState.session.status === "authenticated"
      ? authState.session.user.id
      : null;

  useEffect(() => {
    if (memberId === null) return;

    const controller = new AbortController();
    let active = true;
    void fetchRecipeViewerState(recipeVersionId, controller.signal)
      .then((viewerState) => {
        if (!active) return;
        setPrivateState(
          viewerState === null
            ? { phase: "error", ownerId: memberId }
            : { phase: "ready", ownerId: memberId, viewerState },
        );
      })
      .catch((reason: unknown) => {
        if (
          active &&
          !isAbortError(reason)
        ) {
          setPrivateState({ phase: "error", ownerId: memberId });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [memberId, recipeVersionId, retryCount]);

  const viewerState =
    memberId !== null &&
    privateState.phase === "ready" &&
    privateState.ownerId === memberId
      ? privateState.viewerState
      : null;
  const privateStateFailed =
    memberId !== null &&
    privateState.phase === "error" &&
    privateState.ownerId === memberId;
  const authenticatedPrimaryAction = (
    <LoadingButton
      className="recipe-action-button recipe-action-button--primary"
      type="button"
      pending={editAction.pending}
      pendingLabel="Preparing your version…"
      onClick={onRequestEdit}
    >
      <BranchIcon />
      <span>
        {editAction.hasActiveDraft
          ? "Continue your version"
          : "Make your own version"}
      </span>
    </LoadingButton>
  );

  let controls;
  let statusContent = null;

  if (authState.phase === "loading") {
    controls = (
      <SignedOutToolbar
        onPrompt={() => undefined}
        primaryAction={
          <LoadingButton
            className="recipe-action-button recipe-action-button--primary is-disabled"
            type="button"
            pending
            pendingLabel="Checking account…"
          >
            <BranchIcon />
            <span>Make your own version</span>
          </LoadingButton>
        }
      />
    );
  } else if (authState.phase === "error") {
    controls = (
      <SignedOutToolbar
        onPrompt={() => undefined}
        primaryAction={
          <button
            className="recipe-action-button recipe-action-button--primary"
            type="button"
            onClick={() => void refreshSession()}
          >
            Retry account check
          </button>
        }
      />
    );
    statusContent = (
      <p>We couldn’t check your account. Retry to use recipe actions.</p>
    );
  } else if (authState.session.status === "anonymous") {
    controls = (
      <SignedOutToolbar
        onPrompt={setAuthPrompt}
        primaryAction={
          <Link
            className="recipe-action-button recipe-action-button--primary"
            href={accountHref("/sign-in", forkHref)}
          >
            <BranchIcon />
            <span>Make your own version</span>
          </Link>
        }
      />
    );
  } else if (authState.session.status === "onboarding_required") {
    controls = (
      <SignedOutToolbar
        onPrompt={setAuthPrompt}
        primaryAction={
          <Link
            className="recipe-action-button recipe-action-button--primary"
            href={accountHref("/onboarding", forkHref)}
          >
            <BranchIcon />
            <span>Make your own version</span>
          </Link>
        }
      />
    );
  } else if (viewerState !== null) {
    controls = (
      <RecipeInteractionPanel
        key={`${memberId}:${recipeVersionId}`}
        initialViewerState={viewerState}
        onSavedChange={(saved, previouslySaved) => {
          if (saved === previouslySaved) return;
          setDisplayedSaveCount((count) =>
            Math.max(0, count + (saved ? 1 : -1)),
          );
        }}
        primaryAction={authenticatedPrimaryAction}
      />
    );
  } else {
    controls = (
      <SignedOutToolbar
        onPrompt={() => undefined}
        primaryAction={authenticatedPrimaryAction}
      />
    );
    statusContent = privateStateFailed ? (
      <>
        <p>We couldn’t load your saved and rating state.</p>
        <button
          className="button button--secondary"
          type="button"
          onClick={() => {
            if (memberId !== null) {
              setPrivateState({ phase: "idle" });
              setRetryCount((count) => count + 1);
            }
          }}
        >
          Retry saved and rating state
        </button>
      </>
    ) : (
      <InlineLoading label="Loading your saved and rating state…" />
    );
  }

  const isOnboarding =
    authState.phase === "ready" &&
    authState.session.status === "onboarding_required";
  const authPath = isOnboarding ? "/onboarding" : "/sign-in";
  const promptTitle =
    authPrompt === "rate"
      ? "Sign in to rate recipes"
      : "Sign in to save recipes";
  const promptCopy =
    authPrompt === "rate"
      ? "Your ratings help you keep track of the recipes you liked."
      : "Save recipes so you can find them again from your account.";

  return (
    <div className="recipe-member-actions">
      <div className="recipe-detail__social-row">
        <RatingSummary average={averageRating} count={ratingCount} />
        <span className="recipe-detail__save-count">
          {displayedSaveCount.toLocaleString("en-US")} {displayedSaveCount === 1 ? "save" : "saves"}
        </span>
      </div>

      {controls}

      {statusContent ? (
        <section
          className="recipe-member-status"
          aria-label="Member recipe actions"
        >
          {statusContent}
        </section>
      ) : null}

      {editAction.errorMessage !== null ? (
        <p className="recipe-member-status" role="alert">
          {editAction.errorMessage}
        </p>
      ) : null}

      {viewerState !== null ? (
        <RecipeViewTracker recipeVersionId={recipeVersionId} />
      ) : null}

      {authPrompt !== null ? (
        <section
          className="recipe-auth-prompt"
          role="dialog"
          aria-modal="false"
          aria-labelledby="recipe-auth-prompt-title"
        >
          <h2 id="recipe-auth-prompt-title">{promptTitle}</h2>
          <p>{promptCopy}</p>
          <div className="recipe-auth-prompt__actions">
            <Link
              className="button button--primary"
              href={accountHref(authPath, returnTo)}
            >
              {isOnboarding ? "Finish setup" : "Sign in"}
            </Link>
            <button
              className="button button--quiet"
              type="button"
              onClick={() => setAuthPrompt(null)}
            >
              Not now
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
