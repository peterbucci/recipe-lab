"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { createIdempotencyKey } from "../../lib/idempotency-key";
import {
  fetchCookFollowState,
  type CookFollowState,
  setCookFollowing,
} from "../../lib/member-follow-api";
import { useAuthSession } from "./auth-session-provider";
import { LoadingButton } from "./loading-ui";

interface CookFollowControlProps {
  cookId: string;
  displayName: string;
  handle: string;
  initialFollowerCount: number;
  profileDescription?: string | null;
  recipeCount?: number;
  returnTo?: string;
  showCount?: boolean;
  variant?: "default" | "inline" | "profile";
}

type PrivateState =
  | { phase: "idle" }
  | { ownerId: string; phase: "ready"; state: CookFollowState }
  | { ownerId: string; phase: "error" };

interface FollowAttempt {
  fingerprint: string;
  idempotencyKey: string;
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

function followerLabel(count: number): string {
  return `${count} ${count === 1 ? "follower" : "followers"}`;
}

function recipeLabel(count: number): string {
  return `${count} ${count === 1 ? "recipe" : "recipes"}`;
}

function accountHref(
  path: "/onboarding" | "/sign-in",
  handle: string,
  returnTo?: string,
): string {
  const destination = returnTo ?? `/cooks/${encodeURIComponent(handle)}`;
  return `${path}?${new URLSearchParams({ return_to: destination }).toString()}`;
}

export function CookFollowControl({
  cookId,
  displayName,
  handle,
  initialFollowerCount,
  profileDescription,
  recipeCount = 0,
  returnTo,
  showCount = true,
  variant = "default",
}: CookFollowControlProps) {
  const { refreshSession, sessionExpired, state: authState } = useAuthSession();
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    clientHydrationSnapshot,
    serverHydrationSnapshot,
  );
  const attemptRef = useRef<FollowAttempt | null>(null);
  const [privateState, setPrivateState] = useState<PrivateState>({
    phase: "idle",
  });
  const [retryCount, setRetryCount] = useState(0);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const memberId =
    authState.phase === "ready" && authState.session.status === "authenticated"
      ? authState.session.user.id
      : null;
  const isOwnProfile = memberId === cookId;

  useEffect(() => {
    if (memberId === null || isOwnProfile || sessionExpired) return;
    const controller = new AbortController();
    let active = true;
    void fetchCookFollowState(handle, controller.signal)
      .then((state) => {
        if (!active) return;
        if (state.cook_id !== cookId) {
          setPrivateState({ ownerId: memberId, phase: "error" });
          return;
        }
        setPrivateState({ ownerId: memberId, phase: "ready", state });
      })
      .catch((reason: unknown) => {
        if (
          active &&
          !(reason instanceof DOMException && reason.name === "AbortError")
        ) {
          setPrivateState({ ownerId: memberId, phase: "error" });
        }
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [cookId, handle, isOwnProfile, memberId, retryCount, sessionExpired]);

  const followState =
    memberId !== null &&
    privateState.phase === "ready" &&
    privateState.ownerId === memberId
      ? privateState.state
      : null;
  const followStateFailed =
    memberId !== null &&
    privateState.phase === "error" &&
    privateState.ownerId === memberId;
  const followerCount = followState?.follower_count ?? initialFollowerCount;

  async function toggleFollow() {
    if (followState === null || memberId === null || pending) return;
    const nextFollowing = !followState.following;
    const fingerprint = `${memberId}:${cookId}:${nextFollowing}`;
    if (attemptRef.current?.fingerprint !== fingerprint) {
      attemptRef.current = {
        fingerprint,
        idempotencyKey: createIdempotencyKey(),
      };
    }
    setPending(true);
    setErrorMessage("");
    try {
      const updated = await setCookFollowing(
        handle,
        nextFollowing,
        attemptRef.current.idempotencyKey,
      );
      if (updated.cook_id !== cookId)
        throw new TypeError("Follow target mismatch.");
      setPrivateState({ ownerId: memberId, phase: "ready", state: updated });
    } catch {
      setErrorMessage(
        `We couldn’t ${nextFollowing ? "follow" : "unfollow"} ${displayName}. Your previous choice is unchanged.`,
      );
    } finally {
      setPending(false);
    }
  }

  let control = null;
  if (!isOwnProfile) {
    if (!hydrated || authState.phase === "loading") {
      control = (
        <LoadingButton
          className="button button--secondary"
          type="button"
          pending
          pendingLabel="Checking account…"
        >
          Follow
        </LoadingButton>
      );
    } else if (authState.phase === "error") {
      control = (
        <button
          className="button button--secondary"
          type="button"
          onClick={() => void refreshSession()}
        >
          Retry account check
        </button>
      );
    } else if (authState.session.status === "anonymous" || sessionExpired) {
      control = (
        <Link
          className="button button--secondary"
          href={accountHref("/sign-in", handle, returnTo)}
        >
          Follow
        </Link>
      );
    } else if (authState.session.status === "onboarding_required") {
      control = (
        <Link
          className="button button--secondary"
          href={accountHref("/onboarding", handle, returnTo)}
        >
          Follow
        </Link>
      );
    } else if (followStateFailed) {
      control = (
        <button
          className="button button--secondary"
          type="button"
          onClick={() => {
            setPrivateState({ phase: "idle" });
            setRetryCount((current) => current + 1);
          }}
        >
          Retry follow status
        </button>
      );
    } else if (followState === null) {
      control = (
        <LoadingButton
          className="button button--secondary"
          type="button"
          pending
          pendingLabel="Loading follow status…"
        >
          Follow
        </LoadingButton>
      );
    } else {
      control = (
        <LoadingButton
          className={`button ${
            followState.following ? "button--primary" : "button--secondary"
          }`}
          type="button"
          aria-label={
            pending
              ? `${followState.following ? "Unfollowing" : "Following"} ${displayName}…`
              : followState.following
                ? `Unfollow ${displayName}`
                : `Follow ${displayName}`
          }
          aria-pressed={followState.following}
          pending={pending}
          pendingLabel={followState.following ? "Unfollowing…" : "Following…"}
          onClick={() => void toggleFollow()}
        >
          {followState.following ? "Following" : "Follow"}
        </LoadingButton>
      );
    }
  }

  if (!showCount && control === null && !errorMessage) return null;

  return (
    <div className={`cook-follow-control cook-follow-control--${variant}`}>
      {variant === "profile" ? (
        <>
          <p className="cook-profile__meta" aria-live="polite">
            <span className="cook-profile__handle">@{handle}</span>
            <span className="cook-profile__meta-item">
              <span className="cook-profile__meta-separator" aria-hidden="true">
                •
              </span>
              <span className="cook-follow-control__count">
                {followerLabel(followerCount)}
              </span>
            </span>
            <span className="cook-profile__meta-item">
              <span className="cook-profile__meta-separator" aria-hidden="true">
                •
              </span>
              <span className="cook-profile__recipe-count">
                {recipeLabel(recipeCount)}
              </span>
            </span>
          </p>
          {profileDescription?.trim() ? (
            <p className="cook-profile__description">{profileDescription}</p>
          ) : null}
        </>
      ) : showCount ? (
        <span className="cook-follow-control__count" aria-live="polite">
          {followerLabel(followerCount)}
        </span>
      ) : null}
      {control}
      {errorMessage ? (
        <p className="cook-follow-control__error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
