"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useAuthSession } from "./auth-session-provider";

interface RecipeForkGateProps {
  children: ReactNode;
  recipeTitle: string;
  recipeVersionId: string;
}

export function RecipeForkGate({
  children,
  recipeTitle,
  recipeVersionId,
}: RecipeForkGateProps) {
  const { state, refreshSession } = useAuthSession();
  const recipeHref = `/recipes/${encodeURIComponent(recipeVersionId)}`;
  const returnTo = `${recipeHref}/fork`;

  if (state.phase === "ready" && state.session.status === "authenticated") {
    return children;
  }

  let title = "Checking your account…";
  let message = `You can keep reading ${recipeTitle} while Recipe Lab checks your account.`;
  let primaryAction = (
    <span className="button button--disabled" aria-disabled="true">
      Checking account…
    </span>
  );

  if (state.phase === "error") {
    title = "We couldn’t check your account";
    message = "Retry the account check before making a recipe version.";
    primaryAction = (
      <button
        className="button button--primary"
        type="button"
        onClick={() => void refreshSession()}
      >
        Retry account check
      </button>
    );
  } else if (state.phase === "ready" && state.session.status === "anonymous") {
    title = "Sign in to make this recipe your own";
    message = `You can keep reading ${recipeTitle} without an account. Sign in before creating a version so the action is tied to your account.`;
    primaryAction = (
      <Link
        className="button button--primary"
        href={`/sign-in?${new URLSearchParams({ return_to: returnTo }).toString()}`}
      >
        Sign in to continue
      </Link>
    );
  } else if (
    state.phase === "ready" &&
    state.session.status === "onboarding_required"
  ) {
    title = "Finish setting up your account";
    message = "Choose your account details before creating a recipe version.";
    primaryAction = (
      <Link
        className="button button--primary"
        href={`/onboarding?${new URLSearchParams({ return_to: returnTo }).toString()}`}
      >
        Finish account setup
      </Link>
    );
  }

  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card" aria-labelledby="fork-access-title">
        <p className="eyebrow">Make a recipe version</p>
        <h1 id="fork-access-title">{title}</h1>
        <p className="lede" role={state.phase === "loading" ? "status" : undefined}>
          {message}
        </p>
        <div className="button-row auth-card__actions">
          {primaryAction}
          <Link className="button button--secondary" href={recipeHref}>
            Back to recipe
          </Link>
        </div>
      </section>
    </main>
  );
}
