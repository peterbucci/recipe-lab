"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { RecipeVersionReference } from "../../lib/recipe-api";
import {
  fetchRecipeViewerState,
  type RecipeViewerState,
} from "../../lib/interaction-api";
import { useAuthSession } from "./auth-session-provider";
import { RecipeInteractionPanel } from "./recipe-interaction-panel";
import { RecipeReportPanel } from "./recipe-report-panel";
import { RecipeViewTracker } from "./recipe-view-tracker";

interface RecipeMemberActionsProps {
  comparison: RecipeVersionReference | null;
  recipeVersionId: string;
}

type PrivateState =
  | { phase: "idle" }
  | { phase: "ready"; ownerId: string; viewerState: RecipeViewerState }
  | { phase: "error"; ownerId: string };

function accountHref(path: "/onboarding" | "/sign-in", returnTo: string): string {
  return `${path}?${new URLSearchParams({ return_to: returnTo }).toString()}`;
}

export function RecipeMemberActions({
  comparison,
  recipeVersionId,
}: RecipeMemberActionsProps) {
  const { state: authState, refreshSession } = useAuthSession();
  const returnTo = `/recipes/${encodeURIComponent(recipeVersionId)}`;
  const forkHref = `${returnTo}/fork`;
  const [privateState, setPrivateState] = useState<PrivateState>({ phase: "idle" });
  const [retryCount, setRetryCount] = useState(0);

  const memberId =
    authState.phase === "ready" && authState.session.status === "authenticated"
      ? authState.session.user.id
      : null;

  useEffect(() => {
    if (memberId === null) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    void fetchRecipeViewerState(recipeVersionId, controller.signal)
      .then((viewerState) => {
        if (!active) {
          return;
        }
        setPrivateState(
          viewerState === null
            ? { phase: "error", ownerId: memberId }
            : { phase: "ready", ownerId: memberId, viewerState },
        );
      })
      .catch((reason: unknown) => {
        if (
          active &&
          !(reason instanceof DOMException && reason.name === "AbortError")
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

  let primaryAction;
  let gateContent;

  if (authState.phase === "loading") {
    primaryAction = (
      <span className="button button--disabled" aria-disabled="true">
        Checking account…
      </span>
    );
    gateContent = <p role="status">Checking whether recipe actions are available…</p>;
  } else if (authState.phase === "error") {
    primaryAction = (
      <button
        className="button button--primary"
        type="button"
        onClick={() => void refreshSession()}
      >
        Retry account check
      </button>
    );
    gateContent = <p>We couldn’t check your account. Retry to use member recipe actions.</p>;
  } else if (authState.session.status === "anonymous") {
    primaryAction = (
      <Link className="button button--primary" href={accountHref("/sign-in", forkHref)}>
        Sign in to make your own version
      </Link>
    );
    gateContent = <p>Sign in to save or rate this recipe and make your own version.</p>;
  } else if (authState.session.status === "onboarding_required") {
    primaryAction = (
      <Link className="button button--primary" href={accountHref("/onboarding", forkHref)}>
        Finish setup to make a version
      </Link>
    );
    gateContent = <p>Finish account setup to save, rate, and make recipe versions.</p>;
  } else if (viewerState !== null) {
    primaryAction = (
      <Link className="button button--primary" href={forkHref}>
        Make your own version
      </Link>
    );
    gateContent = null;
  } else if (privateStateFailed) {
    primaryAction = (
      <button
        className="button button--primary"
        type="button"
        onClick={() => {
          if (memberId !== null) {
            setPrivateState({ phase: "idle" });
            setRetryCount((count) => count + 1);
          }
        }}
      >
        Retry recipe actions
      </button>
    );
    gateContent = <p>We couldn’t load your saved and rating state. Please retry.</p>;
  } else {
    primaryAction = (
      <span className="button button--disabled" aria-disabled="true">
        Loading your actions…
      </span>
    );
    gateContent = <p role="status">Loading your saved and rating state…</p>;
  }

  return (
    <>
      <div className="button-row recipe-detail__actions">
        {primaryAction}
        {comparison ? (
          <Link
            className="button button--secondary"
            href={`/recipes/${encodeURIComponent(recipeVersionId)}/compare`}
          >
            See what changed
          </Link>
        ) : null}
      </div>
      {viewerState === null ? (
        <section className="recipe-member-gate" aria-label="Member recipe actions">
          {gateContent}
        </section>
      ) : (
        <>
          <RecipeViewTracker recipeVersionId={recipeVersionId} />
          <RecipeInteractionPanel
            key={`${memberId}:${recipeVersionId}`}
            initialViewerState={viewerState}
          />
        </>
      )}
      {memberId !== null ? (
        <RecipeReportPanel key={`report:${memberId}:${recipeVersionId}`} recipeVersionId={recipeVersionId} />
      ) : null}
    </>
  );
}
