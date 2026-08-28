"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  AuthApiError,
  deleteAccount,
  reauthenticateHref,
  signInHref,
} from "../../lib/auth-api";
import { useAuthSession } from "./auth-session-provider";

const SETTINGS_PATH = "/account/settings";

export function AccountSettings() {
  const router = useRouter();
  const { state, refreshSession, replaceSession } = useAuthSession();
  const [acknowledged, setAcknowledged] = useState(false);
  const [handleConfirmation, setHandleConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [recentAuthenticationRequired, setRecentAuthenticationRequired] = useState(false);

  if (state.phase === "loading") {
    return (
      <main id="main-content" className="page-shell account-settings">
        <p role="status">Loading account settings…</p>
      </main>
    );
  }

  if (state.phase === "error") {
    return (
      <main id="main-content" className="auth-page">
        <section className="auth-card" aria-labelledby="settings-error-title">
          <p className="eyebrow">Account settings</p>
          <h1 id="settings-error-title">We couldn’t check your account.</h1>
          <p>Retry the account check before changing account settings.</p>
          <div className="button-row auth-card__actions">
            <button className="button button--primary" type="button" onClick={() => void refreshSession()}>
              Retry account check
            </button>
            <Link className="button button--secondary" href="/recipes">Browse recipes</Link>
          </div>
        </section>
      </main>
    );
  }

  if (state.session.status === "anonymous") {
    return (
      <main id="main-content" className="auth-page">
        <section className="auth-card" aria-labelledby="settings-sign-in-title">
          <p className="eyebrow">Account settings</p>
          <h1 id="settings-sign-in-title">Sign in to manage your account.</h1>
          <p>Account deletion is available only to the person who owns the account.</p>
          <a className="button button--primary" href={signInHref(SETTINGS_PATH)}>Sign in to continue</a>
        </section>
      </main>
    );
  }

  const expectedHandle = state.session.user.handle;
  const confirmationPhrase = expectedHandle ?? "DELETE";
  const confirmationMatches = handleConfirmation === confirmationPhrase;
  const canDelete = acknowledged && confirmationMatches && !pending;

  async function completeDeletion() {
    replaceSession({ status: "anonymous" });
    router.replace("/account/deleted");
    router.refresh();
  }

  async function handleDeleteAccount() {
    if (!canDelete) return;
    setPending(true);
    setError("");
    setRecentAuthenticationRequired(false);
    try {
      await deleteAccount(handleConfirmation);
      await completeDeletion();
      return;
    } catch (reason) {
      if (
        reason instanceof AuthApiError &&
        reason.status === 403 &&
        reason.code === "recent_authentication_required"
      ) {
        setAcknowledged(false);
        setHandleConfirmation("");
        setRecentAuthenticationRequired(true);
        setError("Sign in again to verify your identity before deleting your account.");
      } else if (reason instanceof AuthApiError) {
        setError(
          reason.status === 401
            ? "Your session expired. Sign in again before deleting your account."
            : "Recipe Lab could not delete your account. Nothing was changed. Try again.",
        );
      } else {
        const refreshed = await refreshSession();
        if (refreshed?.status === "anonymous") {
          await completeDeletion();
          return;
        }
        setError(
          "Recipe Lab could not confirm whether deletion finished. Your account still appears active; review it before trying again.",
        );
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <main id="main-content" className="page-shell account-settings">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href={expectedHandle ? "/account/recipes" : "/recipes"}>
          {expectedHandle ? "← Back to my recipes" : "← Back to recipes"}
        </Link>
      </nav>
      <header className="page-intro">
        <p className="eyebrow">Your account</p>
        <h1>Account settings</h1>
        <p>Review what happens to your recipes and private data before deleting your account.</p>
      </header>

      <section className="account-deletion" aria-labelledby="delete-account-title">
        <p className="eyebrow">Permanent action</p>
        <h2 id="delete-account-title">Delete account</h2>
        <div className="account-deletion__disclosure">
          <p>
            Deleting your account permanently removes your sign-in, profile, private drafts,
            saves, ratings, and other private activity. Every signed-in session is ended.
          </p>
          <p>
            Recipes that are public when you delete your account stay public so their recipe
            history remains clear. Their author becomes <strong>Deleted cook</strong>. Recipes you
            withdrew stay unavailable permanently because there will no longer be an account that
            can restore them. Restore anything you want public before deleting your account.
          </p>
        </div>

        {recentAuthenticationRequired ? (
          <div className="account-deletion__reauth" role="alert">
            <h3>Verify your identity to continue</h3>
            <p>{error}</p>
            <div className="button-row">
              <a className="button button--primary" href={reauthenticateHref(SETTINGS_PATH)}>
                Verify identity
              </a>
              <button
                className="button button--quiet"
                type="button"
                onClick={() => {
                  setRecentAuthenticationRequired(false);
                  setError("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <form
            className="account-deletion__form"
            aria-busy={pending}
            onSubmit={(event) => {
              event.preventDefault();
              void handleDeleteAccount();
            }}
          >
            <label className="account-deletion__acknowledgement">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={pending}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>
                I understand that account deletion is permanent and that public recipes remain
                under Deleted cook.
              </span>
            </label>
            <label className="profile-form__field" htmlFor="delete-account-handle">
              <span>
                Type <strong>{confirmationPhrase}</strong> to confirm
              </span>
              <input
                id="delete-account-handle"
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck="false"
                value={handleConfirmation}
                disabled={pending}
                aria-describedby="delete-account-handle-help"
                onChange={(event) => setHandleConfirmation(event.target.value)}
              />
              <p id="delete-account-handle-help">
                {expectedHandle
                  ? "The handle must match exactly."
                  : "The confirmation phrase must match exactly."}
              </p>
            </label>
            <button className="button button--danger" type="submit" disabled={!canDelete}>
              {pending ? "Deleting account…" : "Permanently delete account"}
            </button>
          </form>
        )}

        {error && !recentAuthenticationRequired ? (
          <p className="form-alert account-deletion__error" role="alert">{error}</p>
        ) : null}
      </section>
    </main>
  );
}
