"use client";

import Link from "next/link";

import { useAuthSession } from "./auth-session-provider";
import { MemberIngredientRequestHistory } from "./member-ingredient-request-history";

const RETURN_TO = "/account/ingredient-requests";

export function MyIngredientRequestsWorkspace() {
  const { state, refreshSession } = useAuthSession();

  if (state.phase === "loading") {
    return (
      <main
        id="main-content"
        className="state-page account-workspace-page account-ingredient-requests-page"
      >
        <div className="loading-state" role="status" aria-live="polite">
          <span className="loading-state__pulse" aria-hidden="true" />
          <strong>Loading your ingredient requests…</strong>
          <span>Checking your account and request history.</span>
        </div>
      </main>
    );
  }

  if (state.phase === "error") {
    return (
      <main
        id="main-content"
        className="state-page account-workspace-page account-ingredient-requests-page"
      >
        <div className="error-state" role="alert">
          <p className="eyebrow">Account unavailable</p>
          <h1>We couldn’t check your account.</h1>
          <p>Try the account check again before opening your ingredient requests.</p>
          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              onClick={() => void refreshSession()}
            >
              Try again
            </button>
            <Link className="button button--secondary" href="/recipes">
              Browse recipes
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (state.session.status === "anonymous") {
    return (
      <main
        id="main-content"
        className="auth-page account-workspace-page account-ingredient-requests-page"
      >
        <section className="auth-card" aria-labelledby="request-history-sign-in-title">
          <p className="eyebrow">Ingredient requests</p>
          <h1 id="request-history-sign-in-title">Sign in to see your requests.</h1>
          <p className="lede">
            Your request history is private to your account. Sign in to track curator decisions.
          </p>
          <div className="button-row auth-card__actions">
            <Link
              className="button button--primary"
              href={`/sign-in?${new URLSearchParams({ return_to: RETURN_TO }).toString()}`}
            >
              Sign in to continue
            </Link>
            <Link className="button button--secondary" href="/recipes">
              Browse recipes
            </Link>
          </div>
        </section>
      </main>
    );
  }

  if (state.session.status === "onboarding_required") {
    return (
      <main
        id="main-content"
        className="auth-page account-workspace-page account-ingredient-requests-page"
      >
        <section className="auth-card" aria-labelledby="request-history-onboarding-title">
          <p className="eyebrow">Ingredient requests</p>
          <h1 id="request-history-onboarding-title">Finish setting up your account.</h1>
          <p className="lede">Choose your account details before opening your request history.</p>
          <div className="button-row auth-card__actions">
            <Link
              className="button button--primary"
              href={`/onboarding?${new URLSearchParams({ return_to: RETURN_TO }).toString()}`}
            >
              Finish account setup
            </Link>
            <Link className="button button--secondary" href="/recipes">
              Browse recipes
            </Link>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main
      id="main-content"
      className="page-shell account-workspace-page account-ingredient-requests-page member-request-page"
    >
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/recipes">← Back to recipes</Link>
      </nav>
      <header className="page-intro member-request-page__intro">
        <p className="eyebrow">Catalog requests</p>
        <h1>My ingredient requests</h1>
        <p>
          Follow each missing-ingredient request from review to resolution. Approved and duplicate
          resolutions become available in ingredient pickers; pending and rejected request text
          never becomes a trusted ingredient.
        </p>
      </header>
      <MemberIngredientRequestHistory idPrefix="account-ingredient-requests" />
    </main>
  );
}
