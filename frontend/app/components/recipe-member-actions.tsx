"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

import { isAbortError } from "../../lib/abort-error";
import {
  fetchRecipeViewerState,
  type RecipeViewerState,
} from "../../lib/interaction-api";
import type { RecipeVersionReference } from "../../lib/recipe-api";
import { findActiveRecipeDraftForSource } from "../../lib/recipe-draft-api";
import {
  prepareRecipeDraftEditorEntry,
  RecipeDraftEditorEntryError,
  type RecipeDraftEditorEntry,
} from "../../lib/recipe-draft-editor-entry";
import {
  recipeDraftEntryErrorMessage,
  startOrResumeRecipeDraft,
} from "../../lib/recipe-draft-entry";
import { useAuthSession } from "./auth-session-provider";
import { InlineLoading, LoadingButton } from "./loading-ui";
import { RatingSummary } from "./rating-summary";
import { BranchIcon, HeartIcon, StarIcon } from "./recipe-action-icons";
import { RecipeInteractionPanel } from "./recipe-interaction-panel";
import { RecipeViewTracker } from "./recipe-view-tracker";

interface RecipeMemberActionsProps {
  averageRating: number | null;
  comparison: RecipeVersionReference | null;
  onActiveDraftChange?: (hasActiveDraft: boolean) => void;
  ratingCount: number;
  recipeVersionId: string;
  saveCount: number;
  showComparisonAction?: boolean;
  onEditableVersionReady?: (entry: RecipeDraftEditorEntry) => void | Promise<void>;
}

type PrivateState =
  | { phase: "idle" }
  | { phase: "ready"; ownerId: string; viewerState: RecipeViewerState }
  | { phase: "error"; ownerId: string };

type ActiveDraftState =
  | { phase: "idle" }
  | { phase: "ready"; ownerId: string; draftId: string | null }
  | { phase: "error"; ownerId: string };

type AuthPrompt = "rate" | "save" | null;

type DraftEntryState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string };

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
  comparison,
  onActiveDraftChange,
  ratingCount,
  recipeVersionId,
  saveCount,
  showComparisonAction = true,
  onEditableVersionReady,
}: RecipeMemberActionsProps) {
  const router = useRouter();
  const { state: authState, refreshSession } = useAuthSession();
  const returnTo = `/recipes/${encodeURIComponent(recipeVersionId)}`;
  const forkHref = `${returnTo}/fork`;
  const [privateState, setPrivateState] = useState<PrivateState>({
    phase: "idle",
  });
  const [activeDraftState, setActiveDraftState] = useState<ActiveDraftState>({
    phase: "idle",
  });
  const [retryCount, setRetryCount] = useState(0);
  const [authPrompt, setAuthPrompt] = useState<AuthPrompt>(null);
  const [draftEntryState, setDraftEntryState] = useState<DraftEntryState>({
    phase: "idle",
  });
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

  useEffect(() => {
    if (memberId === null) return;

    const controller = new AbortController();
    let active = true;
    void findActiveRecipeDraftForSource(recipeVersionId, controller.signal)
      .then((draft) => {
        if (!active) return;
        setActiveDraftState({
          phase: "ready",
          ownerId: memberId,
          draftId: draft?.id ?? null,
        });
      })
      .catch((reason: unknown) => {
        if (
          active &&
          !isAbortError(reason)
        ) {
          setActiveDraftState({ phase: "error", ownerId: memberId });
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
  const activeDraftId =
    memberId !== null &&
    activeDraftState.phase === "ready" &&
    activeDraftState.ownerId === memberId
      ? activeDraftState.draftId
      : null;

  useEffect(() => {
    onActiveDraftChange?.(activeDraftId !== null);
  }, [activeDraftId, onActiveDraftChange]);

  const primaryActionHref =
    activeDraftId === null
      ? forkHref
      : `/recipes/drafts/${encodeURIComponent(activeDraftId)}`;

  async function enterEditableVersion() {
    if (memberId === null || draftEntryState.phase === "loading") return;
    setDraftEntryState({ phase: "loading" });
    try {
      if (onEditableVersionReady) {
        const entry = await prepareRecipeDraftEditorEntry(
          memberId,
          recipeVersionId,
        );
        await onEditableVersionReady(entry);
      } else {
        const draftId = await startOrResumeRecipeDraft(memberId, recipeVersionId);
        router.push(`/recipes/drafts/${encodeURIComponent(draftId)}`);
      }
    } catch (reason) {
      setDraftEntryState({
        phase: "error",
        message:
          reason instanceof RecipeDraftEditorEntryError
            ? reason.message
            : recipeDraftEntryErrorMessage(reason),
      });
    }
  }

  const authenticatedPrimaryAction =
    activeDraftId !== null && !onEditableVersionReady ? (
      <Link
        className="recipe-action-button recipe-action-button--primary"
        href={primaryActionHref}
      >
        <BranchIcon />
        <span>Continue your version</span>
      </Link>
    ) : (
      <LoadingButton
        className="recipe-action-button recipe-action-button--primary"
        type="button"
        pending={draftEntryState.phase === "loading"}
        pendingLabel="Preparing your version…"
        onClick={() => void enterEditableVersion()}
      >
        <BranchIcon />
        <span>
          {activeDraftId !== null
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

      {draftEntryState.phase === "error" ? (
        <p className="recipe-member-status" role="alert">
          {draftEntryState.message}
        </p>
      ) : null}

      {comparison && showComparisonAction ? (
        <Link
          className="recipe-member-comparison-link"
          href={`/recipes/${encodeURIComponent(recipeVersionId)}/compare`}
        >
          See what changed
        </Link>
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
