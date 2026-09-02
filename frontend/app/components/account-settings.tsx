"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  useState,
} from "react";

import {
  type AccountUser,
  AuthApiError,
  deleteAccount,
  reauthenticateHref,
  signInHref,
  updateAccountProfile,
} from "../../lib/auth-api";
import { useAuthSession } from "./auth-session-provider";
import { AuthGateLoading, LoadingButton } from "./loading-ui";
import { WorkspacePanelHeader } from "./workspace-panel-header";
import { WorkspaceTabs } from "./workspace-tab-menu";

const SETTINGS_PATH = "/account/settings";
type SettingsSection = "profile" | "danger";

interface PublicProfileSettingsProps {
  hidden: boolean;
  user: AccountUser & { handle: string };
}

function PublicProfileSettings({ hidden, user }: PublicProfileSettingsProps) {
  const { replaceSession } = useAuthSession();
  const [description, setDescription] = useState(user.description ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const normalizedDescription = description.trim();
    setPending(true);
    setError("");
    setSaved("");
    try {
      const updatedSession = await updateAccountProfile({
        handle: user.handle,
        display_name: user.display_name,
        description: normalizedDescription || null,
      });
      replaceSession(updatedSession);
      setDescription(updatedSession.user.description ?? "");
      setSaved("Profile saved.");
    } catch (reason) {
      setError(
        reason instanceof AuthApiError && reason.status === 401
          ? "Your session expired. Sign in again before saving your profile."
          : "We couldn’t save your profile description. Your previous description is unchanged.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      id="account-settings-profile-panel"
      className="account-settings__panel account-settings__panel--profile"
      role="tabpanel"
      aria-labelledby="account-settings-profile-tab"
      hidden={hidden}
    >
      <WorkspacePanelHeader
        description="Control the short introduction shown on your public cook profile."
        title="Public profile"
      />

      <div className="account-settings__profile-layout">
        <form
          className="public-profile-settings__form"
          aria-busy={pending}
          onSubmit={handleSubmit}
        >
          <div className="profile-form__field account-settings__field">
            <label htmlFor="profile-description">About you</label>
            <textarea
              id="profile-description"
              name="description"
              rows={4}
              maxLength={500}
              placeholder="Tell other cooks a little about yourself."
              value={description}
              disabled={pending}
              aria-describedby="profile-description-help profile-description-count"
              onChange={(event) => {
                setDescription(event.target.value);
                setSaved("");
              }}
            />
            <span className="public-profile-settings__field-meta">
              <span id="profile-description-help">Optional</span>
              <span id="profile-description-count">{description.length} / 500</span>
            </span>
          </div>
          <div className="button-row public-profile-settings__actions">
            <LoadingButton
              className="button button--primary"
              type="submit"
              pending={pending}
              pendingLabel="Saving profile…"
            >
              Save profile
            </LoadingButton>
            <Link className="button button--secondary" href={`/cooks/${user.handle}`}>
              View public profile
            </Link>
          </div>
          {saved ? (
            <p className="public-profile-settings__success" role="status">
              {saved}
            </p>
          ) : null}
          {error ? <p className="form-alert" role="alert">{error}</p> : null}
        </form>

        <aside className="account-settings__profile-preview" aria-label="Public profile preview">
          <p className="account-settings__preview-label">Public preview</p>
          <div className="account-settings__preview-user">
            <span className="account-settings__preview-avatar" aria-hidden="true">
              {user.display_name.trim().slice(0, 1).toLocaleUpperCase() || "C"}
            </span>
            <div className="account-settings__preview-identity">
              <strong>{user.display_name}</strong>
              <span>@{user.handle}</span>
              <p className="account-settings__preview-description">
                {description.trim() || "Your description will appear here."}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}

export function AccountSettings() {
  const router = useRouter();
  const { state, refreshSession, replaceSession } = useAuthSession();
  const [acknowledged, setAcknowledged] = useState(false);
  const [handleConfirmation, setHandleConfirmation] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [recentAuthenticationRequired, setRecentAuthenticationRequired] = useState(false);
  const [requestedSection, setRequestedSection] = useState<SettingsSection>("profile");

  if (state.phase === "loading") {
    return (
      <main
        id="main-content"
        className="page-shell account-settings account-settings-page account-settings-page--loading"
      >
        <AuthGateLoading label="Loading account settings…" />
      </main>
    );
  }

  if (state.phase === "error") {
    return (
      <main
        id="main-content"
        className="auth-page account-access-page account-access-page--settings"
      >
        <section
          className="auth-card account-access-card account-access-card--settings"
          aria-labelledby="settings-error-title"
        >
          <p className="eyebrow">Settings</p>
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
      <main
        id="main-content"
        className="auth-page account-access-page account-access-page--settings"
      >
        <section
          className="auth-card account-access-card account-access-card--settings"
          aria-labelledby="settings-sign-in-title"
        >
          <p className="eyebrow">Settings</p>
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
  const availableSections: SettingsSection[] = expectedHandle
    ? ["profile", "danger"]
    : ["danger"];
  const activeSection = availableSections.includes(requestedSection)
    ? requestedSection
    : "danger";

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
    <main
      id="main-content"
      className="page-shell account-settings account-settings-page"
    >
      <header className="page-intro">
        <h1>Settings</h1>
        <p>Manage your public profile and account controls.</p>
      </header>

      <div className="account-settings__shell">
        <WorkspaceTabs
          className="account-settings__tabs"
          ariaLabel="Settings categories"
          items={availableSections.map((section) => ({
            className:
              section === "danger"
                ? "account-settings__tab account-settings__tab--danger"
                : "account-settings__tab",
            count: 1,
            id: `account-settings-${section}-tab`,
            label: section === "profile" ? "Profile" : "Danger zone",
            panelId: `account-settings-${section}-panel`,
            value: section,
          }))}
          value={activeSection}
          onChange={setRequestedSection}
        />

        {expectedHandle ? (
          <PublicProfileSettings
            key={state.session.user.id}
            hidden={activeSection !== "profile"}
            user={{ ...state.session.user, handle: expectedHandle }}
          />
        ) : null}

        <section
          id="account-settings-danger-panel"
          className="account-settings__panel account-settings__panel--danger"
          role="tabpanel"
          aria-labelledby="account-settings-danger-tab"
          hidden={activeSection !== "danger"}
        >
          <WorkspacePanelHeader
            description="Permanent account actions that cannot be undone."
            title="Danger zone"
          />

          <div className="account-settings__danger-content">
            <section className="account-deletion" aria-labelledby="delete-account-title">
              <div className="account-settings__danger-heading">
                <span className="account-settings__danger-icon" aria-hidden="true">
                  !
                </span>
                <div>
                  <h3 id="delete-account-title">Delete account</h3>
                  <p>Permanently remove your account and private Recipe Lab data.</p>
                </div>
              </div>

              <div className="account-deletion__disclosure">
                <p><strong>Deleting your account cannot be undone.</strong></p>
                <p>
                  Private drafts, saves, ratings, profile data, and signed-in sessions are
                  removed.
                </p>
                <details>
                  <summary>What happens to my published recipes?</summary>
                  <ul>
                    <li>
                      Public recipes remain public so their recipe-family history stays intact.
                    </li>
                    <li>
                      The author name is replaced with <strong>Deleted cook</strong>.
                    </li>
                    <li>
                      Withdrawn recipes remain unavailable because the deleted account can no
                      longer restore them.
                    </li>
                  </ul>
                </details>
              </div>

              {recentAuthenticationRequired ? (
                <div className="account-deletion__reauth" role="alert">
                  <h4>Verify your identity to continue</h4>
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
                      I understand that account deletion is permanent and that public recipes
                      remain under Deleted cook.
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
                  <LoadingButton
                    className="button button--danger"
                    type="submit"
                    disabled={!canDelete}
                    pending={pending}
                    pendingLabel="Deleting account…"
                  >
                    Permanently delete account
                  </LoadingButton>
                </form>
              )}

              {error && !recentAuthenticationRequired ? (
                <p className="form-alert account-deletion__error" role="alert">{error}</p>
              ) : null}
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}
