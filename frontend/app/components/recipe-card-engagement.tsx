"use client";

import Link from "next/link";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { isAbortError } from "../../lib/abort-error";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import {
  fetchRecipeViewerState,
  fetchRecipeViewerStates,
  type RecipeViewerState,
  setRecipeSaved,
} from "../../lib/interaction-api";
import { useAuthSession } from "./auth-session-provider";
import { LoadingButton } from "./loading-ui";

interface RecipeCardEngagementProps {
  averageRating: number | null;
  children: ReactNode;
  lineageLabel: ReactNode;
  ratingCount: number;
  recipeVersionId: string;
  saveCount: number;
  servings: string;
  title: string;
}

function HeartIcon({ filled = false }: { filled?: boolean }) {
  return (
    <span
      className={`recipe-card-engagement__heart-glyph${
        filled ? " recipe-card-engagement__heart-glyph--filled" : ""
      }`}
      aria-hidden="true"
    >
      <span className="recipe-card-engagement__heart-outline">♡</span>
      <span className="recipe-card-engagement__heart-fill">♥</span>
    </span>
  );
}

function subscribeToHydration() {
  return () => undefined;
}

function clientHydrationSnapshot() {
  return true;
}

function serverHydrationSnapshot() {
  return false;
}

interface ActionAttempt {
  fingerprint: string;
  idempotencyKey: string;
}

type PrivateState =
  | { phase: "idle" }
  | { phase: "ready"; ownerId: string; viewerState: RecipeViewerState }
  | { phase: "error"; ownerId: string };

type SharedPrivateState =
  | { phase: "idle" }
  | { phase: "loading"; ownerId: string }
  | {
      phase: "ready";
      ownerId: string;
      viewerStates: ReadonlyMap<string, RecipeViewerState>;
    }
  | { phase: "error"; ownerId: string };

interface RecipeCardViewerStateContextValue {
  retry: () => void;
  state: SharedPrivateState;
  updateViewerState: (ownerId: string, viewerState: RecipeViewerState) => void;
}

interface RecipeCardViewerStateProviderProps {
  children: ReactNode;
  recipeVersionIds: readonly string[];
}

const RecipeCardViewerStateContext =
  createContext<RecipeCardViewerStateContextValue | null>(null);

export function RecipeCardViewerStateProvider({
  children,
  recipeVersionIds,
}: RecipeCardViewerStateProviderProps) {
  const { sessionExpired, state: authState } = useAuthSession();
  const [state, setState] = useState<SharedPrivateState>({ phase: "idle" });
  const [retryCount, setRetryCount] = useState(0);
  const recipeVersionKey = [...new Set(recipeVersionIds)].join(",");
  const uniqueRecipeVersionIds = useMemo(
    () => (recipeVersionKey ? recipeVersionKey.split(",") : []),
    [recipeVersionKey],
  );
  const memberId =
    authState.phase === "ready" && authState.session.status === "authenticated"
      ? authState.session.user.id
      : null;

  useEffect(() => {
    if (memberId === null || sessionExpired) {
      return;
    }

    const controller = new AbortController();
    let active = true;
    void fetchRecipeViewerStates(uniqueRecipeVersionIds, controller.signal)
      .then((viewerStates) => {
        if (!active) {
          return;
        }
        setState({
          phase: "ready",
          ownerId: memberId,
          viewerStates: new Map(
            viewerStates.map((viewerState) => [
              viewerState.recipe_version_id,
              viewerState,
            ]),
          ),
        });
      })
      .catch((reason: unknown) => {
        if (
          active &&
          !isAbortError(reason)
        ) {
          setState({ phase: "error", ownerId: memberId });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [memberId, retryCount, sessionExpired, uniqueRecipeVersionIds]);

  const retry = useCallback(() => {
    setRetryCount((current) => current + 1);
  }, []);
  const updateViewerState = useCallback(
    (ownerId: string, viewerState: RecipeViewerState) => {
      setState((current) => {
        if (current.phase !== "ready" || current.ownerId !== ownerId) {
          return current;
        }
        const viewerStates = new Map(current.viewerStates);
        viewerStates.set(viewerState.recipe_version_id, viewerState);
        return { ...current, viewerStates };
      });
    },
    [],
  );
  const value = useMemo(
    () => ({ retry, state, updateViewerState }),
    [retry, state, updateViewerState],
  );

  return (
    <RecipeCardViewerStateContext.Provider value={value}>
      {children}
    </RecipeCardViewerStateContext.Provider>
  );
}

function accountHref(
  path: "/onboarding" | "/sign-in",
  recipeVersionId: string,
): string {
  const returnTo = `/recipes/${encodeURIComponent(recipeVersionId)}`;
  return `${path}?${new URLSearchParams({ return_to: returnTo }).toString()}`;
}

function ratingLabel(
  averageRating: number | null,
  ratingCount: number,
): string {
  if (averageRating === null || ratingCount === 0) {
    return "No ratings yet";
  }
  return `${averageRating.toFixed(1)} out of 5 from ${ratingCount} ${
    ratingCount === 1 ? "rating" : "ratings"
  }`;
}

function ratingStars(averageRating: number | null): string {
  const filled = averageRating === null ? 0 : Math.round(averageRating);
  return `${"★".repeat(filled)}${"☆".repeat(5 - filled)}`;
}

function saveLabel(saveCount: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    notation: saveCount >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  })
    .format(saveCount)
    .replace("K", "k");
  return `${formatted} ${saveCount === 1 ? "save" : "saves"}`;
}

export function RecipeCardEngagement({
  averageRating,
  children,
  lineageLabel,
  ratingCount,
  recipeVersionId,
  saveCount,
  servings,
  title,
}: RecipeCardEngagementProps) {
  const { refreshSession, sessionExpired, state: authState } = useAuthSession();
  const sharedPrivateState = useContext(RecipeCardViewerStateContext);
  const saveAttemptRef = useRef<ActionAttempt | null>(null);
  const [privateState, setPrivateState] = useState<PrivateState>({
    phase: "idle",
  });
  const [retryCount, setRetryCount] = useState(0);
  const [savePending, setSavePending] = useState(false);
  const [displaySaveCount, setDisplaySaveCount] = useState(saveCount);
  const [saveError, setSaveError] = useState("");
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    clientHydrationSnapshot,
    serverHydrationSnapshot,
  );

  const memberId =
    authState.phase === "ready" && authState.session.status === "authenticated"
      ? authState.session.user.id
      : null;

  useEffect(() => {
    if (sharedPrivateState !== null || memberId === null || sessionExpired) {
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
          !isAbortError(reason)
        ) {
          setPrivateState({ phase: "error", ownerId: memberId });
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [
    memberId,
    recipeVersionId,
    retryCount,
    sessionExpired,
    sharedPrivateState,
  ]);

  const sharedState = sharedPrivateState?.state;
  const viewerState =
    memberId === null
      ? null
      : sharedState !== undefined
        ? sharedState.phase === "ready" && sharedState.ownerId === memberId
          ? (sharedState.viewerStates.get(recipeVersionId) ?? null)
          : null
        : privateState.phase === "ready" && privateState.ownerId === memberId
          ? privateState.viewerState
          : null;
  const privateStateFailed =
    memberId !== null &&
    (sharedState !== undefined
      ? (sharedState.phase === "error" && sharedState.ownerId === memberId) ||
        (sharedState.phase === "ready" &&
          sharedState.ownerId === memberId &&
          !sharedState.viewerStates.has(recipeVersionId))
      : privateState.phase === "error" && privateState.ownerId === memberId);

  async function handleSaveToggle() {
    if (viewerState === null || memberId === null || savePending) {
      return;
    }

    const nextSaved = !viewerState.saved;
    const fingerprint = `${recipeVersionId}:saved:${nextSaved}`;
    if (saveAttemptRef.current?.fingerprint !== fingerprint) {
      saveAttemptRef.current = {
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }

    setSavePending(true);
    setSaveError("");
    try {
      const updatedState = await setRecipeSaved(
        recipeVersionId,
        nextSaved,
        saveAttemptRef.current.idempotencyKey,
      );
      const countChange =
        Number(updatedState.saved) - Number(viewerState.saved);
      setPrivateState({
        phase: "ready",
        ownerId: memberId,
        viewerState: updatedState,
      });
      sharedPrivateState?.updateViewerState(memberId, updatedState);
      setDisplaySaveCount((current) => Math.max(0, current + countChange));
    } catch {
      setSaveError(
        "We couldn’t update this saved recipe. Your previous choice is unchanged.",
      );
    } finally {
      setSavePending(false);
    }
  }

  let saveControl;
  if (!hydrated || authState.phase === "loading") {
    saveControl = (
      <LoadingButton
        compact
        className="recipe-card-engagement__heart"
        type="button"
        pending
        pendingLabel={`Checking account before saving ${title}…`}
      >
        <HeartIcon />
      </LoadingButton>
    );
  } else if (authState.phase === "error") {
    saveControl = (
      <button
        className="recipe-card-engagement__heart"
        type="button"
        aria-label={`Retry account check to save ${title}`}
        onClick={() => void refreshSession()}
      >
        <HeartIcon />
      </button>
    );
  } else if (authState.session.status === "anonymous" || sessionExpired) {
    saveControl = (
      <Link
        className="recipe-card-engagement__heart"
        href={accountHref("/sign-in", recipeVersionId)}
        aria-label={`Sign in to save ${title}`}
      >
        <HeartIcon />
      </Link>
    );
  } else if (authState.session.status === "onboarding_required") {
    saveControl = (
      <Link
        className="recipe-card-engagement__heart"
        href={accountHref("/onboarding", recipeVersionId)}
        aria-label={`Finish account setup to save ${title}`}
      >
        <HeartIcon />
      </Link>
    );
  } else if (privateStateFailed) {
    saveControl = (
      <button
        className="recipe-card-engagement__heart"
        type="button"
        aria-label={`Retry saved state for ${title}`}
        onClick={() => {
          if (sharedPrivateState) {
            sharedPrivateState.retry();
          } else {
            setPrivateState({ phase: "idle" });
            setRetryCount((current) => current + 1);
          }
        }}
      >
        <HeartIcon />
      </button>
    );
  } else if (viewerState === null) {
    saveControl = (
      <LoadingButton
        compact
        className="recipe-card-engagement__heart"
        type="button"
        pending
        pendingLabel={`Loading saved state for ${title}…`}
      >
        <HeartIcon />
      </LoadingButton>
    );
  } else {
    saveControl = (
      <LoadingButton
        compact
        className="recipe-card-engagement__heart"
        type="button"
        aria-label={
          savePending
            ? viewerState.saved
              ? `Removing saved ${title}…`
              : `Saving ${title}…`
            : viewerState.saved
              ? `Remove saved ${title}`
              : `Save ${title}`
        }
        aria-pressed={viewerState.saved}
        pending={savePending}
        pendingLabel={viewerState.saved ? "Removing saved recipe…" : "Saving recipe…"}
        onClick={() => void handleSaveToggle()}
      >
        <HeartIcon filled={viewerState.saved} />
      </LoadingButton>
    );
  }

  const aggregateRatingLabel = ratingLabel(averageRating, ratingCount);

  return (
    <div className="recipe-card-engagement">
      <div className="recipe-card-engagement__topline">
        <p className="recipe-card-engagement__lineage">{lineageLabel}</p>
        {saveControl}
      </div>
      {children}
      <div
        className="recipe-card-engagement__rating"
        aria-label={aggregateRatingLabel}
        role="img"
      >
        <span className="recipe-card-engagement__stars" aria-hidden="true">
          {ratingStars(averageRating)}
        </span>
        <span aria-hidden="true">({ratingCount})</span>
      </div>
      <div className="recipe-card-engagement__meta">
        <span>{saveLabel(displaySaveCount)}</span>
        <span>{servings}</span>
      </div>
      {saveError ? (
        <p className="recipe-card-engagement__error" role="alert">
          {saveError}
        </p>
      ) : null}
    </div>
  );
}
