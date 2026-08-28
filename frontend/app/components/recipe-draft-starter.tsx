"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clearRecipeDraftCreationAttempt,
  getOrCreateRecipeDraftCreationAttempt,
  recipeDraftCreationIntent,
  RecipeDraftCreationAttemptError,
} from "../../lib/recipe-draft-creation-attempt";
import {
  createRecipeDraft,
  RecipeDraftApiError,
} from "../../lib/recipe-draft-api";
import { useAuthSession } from "./auth-session-provider";
import { MemberRouteGate } from "./member-route-gate";

interface RecipeDraftStarterProps {
  sourceVersionId: string | null;
}

interface AuthenticatedRecipeDraftStarterProps {
  actorId: string;
  sourceVersionId: string | null;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeCreationError(reason: unknown): string {
  if (
    reason instanceof RecipeDraftApiError ||
    reason instanceof RecipeDraftCreationAttemptError
  ) {
    return reason.message;
  }
  return "Recipe Lab could not start this private draft. Try again to recover the same draft.";
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
    setPhase("loading");
    setError("");

    try {
      let terminalConflictRecovered = false;
      while (true) {
        const attempt = getOrCreateRecipeDraftCreationAttempt(
          actorId,
          sourceVersionId,
        );
        try {
          const draft = await createRecipeDraft(
            sourceVersionId,
            attempt.idempotency_key,
          );
          if (!UUID_PATTERN.test(draft.id)) {
            throw new RecipeDraftApiError(
              "Recipe Lab could not confirm the private draft. Try again to recover the same draft.",
              502,
              "invalid_recipe_draft_response",
              [],
              "unknown",
            );
          }
          if (!mountedRef.current) return;

          clearRecipeDraftCreationAttempt(attempt, sourceVersionId);
          replace(`/account/recipe-drafts/${encodeURIComponent(draft.id)}`);
          return;
        } catch (reason) {
          const terminalConflict =
            reason instanceof RecipeDraftApiError &&
            reason.code === "idempotency_key_conflict";
          if (!terminalConflict) throw reason;

          // A completed/discarded binding cannot become active again. Retire
          // that definitive key and make one bounded attempt with a fresh key;
          // unknown outcomes keep their original key instead.
          clearRecipeDraftCreationAttempt(attempt, sourceVersionId);
          if (terminalConflictRecovered || !mountedRef.current) throw reason;
          terminalConflictRecovered = true;
        }
      }
    } catch (reason) {
      if (!mountedRef.current) return;
      setError(safeCreationError(reason));
      setPhase("error");
    } finally {
      pendingRef.current = false;
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

  const isFork = sourceVersionId !== null;

  return (
    <main id="main-content" className="auth-page">
      <section
        className="auth-card"
        aria-busy={phase === "loading"}
        aria-labelledby="draft-starter-title"
      >
        <p className="eyebrow">Private recipe workspace</p>
        <h1 id="draft-starter-title">
          {phase === "loading"
            ? "Opening your private draft…"
            : "We couldn’t open your private draft"}
        </h1>
        {phase === "loading" ? (
          <p className="lede" role="status">
            {isFork
              ? "Copying this recipe into a private workspace. The public recipe stays unchanged."
              : "Preparing a private workspace for your new recipe."}
          </p>
        ) : (
          <>
            <p className="form-alert" role="alert">
              {error}
            </p>
            <div className="button-row auth-card__actions">
              <button
                ref={retryButtonRef}
                className="button button--primary"
                type="button"
                onClick={() => void start()}
              >
                Try again
              </button>
            </div>
          </>
        )}
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

  return (
    <MemberRouteGate
      eyebrow="Private recipe workspace"
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
