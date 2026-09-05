"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  recipeDraftCreationIntent,
} from "../../lib/recipe-draft-creation-attempt";
import {
  recipeDraftEntryErrorMessage,
  startOrResumeRecipeDraft,
} from "../../lib/recipe-draft-entry";
import { useAuthSession } from "./auth-session-provider";
import { LoadingButton } from "./loading-ui";
import { MemberRouteGate } from "./member-route-gate";
import { RecipeDraftLoadingView } from "./recipe-draft-editor";

interface RecipeDraftStarterProps {
  sourceVersionId: string | null;
}

interface AuthenticatedRecipeDraftStarterProps {
  actorId: string;
  sourceVersionId: string | null;
}

function AuthenticatedRecipeDraftStarter({
  actorId,
  sourceVersionId,
}: AuthenticatedRecipeDraftStarterProps) {
  const { replace } = useRouter();
  const mountedRef = useRef(false);
  const pendingRef = useRef(false);
  const retryButtonRef = useRef<HTMLButtonElement>(null);
  const [phase, setPhase] = useState<"loading" | "error">("loading");
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const start = useCallback(async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;

    try {
      const draftId = await startOrResumeRecipeDraft(actorId, sourceVersionId);
      if (!mountedRef.current) return;
      replace(`/recipes/drafts/${encodeURIComponent(draftId)}`);
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(recipeDraftEntryErrorMessage(reason));
      setPhase("error");
    } finally {
      pendingRef.current = false;
      if (mountedRef.current) setRetrying(false);
    }
  }, [actorId, replace, sourceVersionId]);

  useEffect(() => {
    void start();
  }, [start]);

  useEffect(() => {
    if (phase !== "error") return;
    const timeout = window.setTimeout(() => retryButtonRef.current?.focus(), 0);
    return () => window.clearTimeout(timeout);
  }, [phase]);

  if (phase === "loading") {
    return (
      <RecipeDraftLoadingView
        draftId={sourceVersionId ?? `new-recipe:${actorId}`}
        status={
          sourceVersionId === null
            ? "Preparing a private workspace for your new recipe."
            : "Copying this recipe into a private workspace. The public recipe stays unchanged."
        }
      />
    );
  }

  const isFork = sourceVersionId !== null;
  const entryKind = isFork ? "fork" : "new";

  return (
    <main
      id="main-content"
      className={`auth-page recipe-authoring-entry recipe-authoring-entry--${entryKind} recipe-authoring-entry--${phase}`}
    >
      <section
        className="auth-card draft-starter recipe-authoring-entry__card"
        aria-labelledby="draft-starter-title"
      >
        <p className="eyebrow">Private recipe workspace</p>
        <h1 id="draft-starter-title">We couldn’t open your private draft</h1>
        <p className="form-alert" role="alert">
          {error}
        </p>
        <div className="button-row auth-card__actions">
          <LoadingButton
            ref={retryButtonRef}
            className="button button--primary"
            type="button"
            pending={retrying}
            pendingLabel="Opening your private draft…"
            onClick={() => {
              setRetrying(true);
              void start();
            }}
          >
            Try again
          </LoadingButton>
        </div>
        <p className="auth-card__fine-print">
          Private by default — this draft will not appear in search, activity,
          or public recipe pages.
        </p>
      </section>
    </main>
  );
}

export function RecipeDraftStarter({
  sourceVersionId,
}: RecipeDraftStarterProps) {
  const { state } = useAuthSession();
  const actorId =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session.user.id
      : null;
  const returnTo = sourceVersionId
    ? `/recipes/${encodeURIComponent(sourceVersionId)}/fork`
    : "/recipes/new";
  const entryKind = sourceVersionId !== null ? "fork" : "new";

  return (
    <MemberRouteGate
      cardClassName="draft-starter recipe-authoring-entry__card"
      eyebrow="Private recipe workspace"
      pageClassName={`recipe-authoring-entry recipe-authoring-entry--${entryKind}`}
      returnTo={returnTo}
      title="Private drafts"
    >
      {actorId ? (
        <AuthenticatedRecipeDraftStarter
          key={`${actorId}:${recipeDraftCreationIntent(sourceVersionId)}`}
          actorId={actorId}
          sourceVersionId={sourceVersionId}
        />
      ) : null}
    </MemberRouteGate>
  );
}
