"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useRef, useState } from "react";

import { useAuthSession } from "./auth-session-provider";
import { AuthGateLoading } from "./loading-ui";
import { MemberIngredientRequestHistory } from "./member-ingredient-request-history";
import { MissingIngredientRequestPanel } from "./missing-ingredient-request-panel";

const RETURN_TO = "/account/ingredient-requests";
const REQUEST_MODAL_ID_PREFIX = "account-new-ingredient-request";

export function MyIngredientRequestsWorkspace() {
  const { state, refreshSession } = useAuthSession();
  const requestButtonRef = useRef<HTMLButtonElement>(null);
  const [requestOpen, setRequestOpen] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);

  function returnFocusToRequestButton() {
    window.setTimeout(() => requestButtonRef.current?.focus(), 0);
  }

  function closeRequestDialog() {
    setRequestOpen(false);
    returnFocusToRequestButton();
  }

  if (state.phase === "loading") {
    return (
      <main
        id="main-content"
        className="state-page account-workspace-page account-ingredient-requests-page"
      >
        <AuthGateLoading label="Checking your account…" />
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
      <header className="page-intro member-request-page__intro">
        <div>
          <h1>Ingredient Requests</h1>
          <p>Track ingredients you&apos;ve asked Recipe Lab to add to the catalog.</p>
        </div>
        <button
          ref={requestButtonRef}
          aria-label="Request an ingredient"
          aria-controls={`${REQUEST_MODAL_ID_PREFIX}-request-dialog`}
          aria-expanded={requestOpen}
          aria-haspopup="dialog"
          className="button button--primary member-request-page__create"
          type="button"
          onClick={() => setRequestOpen(true)}
        >
          <Plus
            aria-hidden="true"
            className="member-request-page__create-icon"
          />
          <span>Request an ingredient</span>
        </button>
      </header>
      <MemberIngredientRequestHistory
        key={historyRevision}
        idPrefix="account-ingredient-requests"
        onRequestIngredient={() => setRequestOpen(true)}
      />
      {requestOpen ? (
        <MissingIngredientRequestPanel
          idPrefix={REQUEST_MODAL_ID_PREFIX}
          initialName=""
          onClose={closeRequestDialog}
          onSubmitted={() => {
            setRequestOpen(false);
            setHistoryRevision((revision) => revision + 1);
            returnFocusToRequestButton();
          }}
        />
      ) : null}
    </main>
  );
}
