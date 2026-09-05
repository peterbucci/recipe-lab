"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";

import {
  AuthApiError,
  type OnboardingAuthSession,
  safeReturnTo,
  updateAccountProfile,
} from "../../lib/auth-api";
import { useAuthSession } from "../components/auth-session-provider";
import { AuthGateLoading, LoadingButton } from "../components/loading-ui";

interface OnboardingFormProps {
  returnTo: string;
}

interface ProfileFieldsProps {
  returnTo: string;
  session: OnboardingAuthSession;
}

interface FieldErrors {
  displayName?: string;
  handle?: string;
}

type ProfileField = "displayName" | "handle";

const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/;
const CONTROL_CHARACTER_PATTERN = /\p{C}/u;

function validateProfile(displayName: string, handle: string): FieldErrors {
  const errors: FieldErrors = {};
  const normalizedDisplayName = displayName.trim();
  const normalizedHandle = handle.trim().toLocaleLowerCase();

  if (!normalizedDisplayName) {
    errors.displayName = "Enter the name for your Recipe Lab account.";
  } else if (normalizedDisplayName.length > 120) {
    errors.displayName = "Display name must be 120 characters or fewer.";
  } else if (CONTROL_CHARACTER_PATTERN.test(normalizedDisplayName)) {
    errors.displayName = "Display name contains an invisible or unsupported character.";
  }

  if (normalizedHandle.length < 3 || normalizedHandle.length > 30) {
    errors.handle = "Handle must be between 3 and 30 characters.";
  } else if (!HANDLE_PATTERN.test(normalizedHandle)) {
    errors.handle =
      "Use lowercase letters, numbers, underscores, or hyphens, and start and end with a letter or number.";
  }

  return errors;
}

function ProfileFields({ returnTo, session }: ProfileFieldsProps) {
  const router = useRouter();
  const { replaceSession } = useAuthSession();
  const [displayName, setDisplayName] = useState(session.user.display_name);
  const [handle, setHandle] = useState(session.user.handle ?? "");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const focusTargetRef = useRef<ProfileField | null>(null);
  const displayNameRef = useRef<HTMLInputElement>(null);
  const handleRef = useRef<HTMLInputElement>(null);

  function queueFirstInvalidField(errors: FieldErrors) {
    focusTargetRef.current = errors.displayName
      ? "displayName"
      : errors.handle
        ? "handle"
        : null;
    setFocusRequest((request) => request + 1);
  }

  useEffect(() => {
    const focusTarget = focusTargetRef.current;
    if (pending || !focusTarget) {
      return;
    }
    (focusTarget === "displayName" ? displayNameRef : handleRef).current?.focus();
    focusTargetRef.current = null;
  }, [focusRequest, pending]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) {
      return;
    }

    const errors = validateProfile(displayName, handle);
    setFieldErrors(errors);
    setFormError("");
    if (Object.keys(errors).length) {
      queueFirstInvalidField(errors);
      return;
    }

    const profile = {
      display_name: displayName.trim(),
      handle: handle.trim().toLocaleLowerCase(),
    };
    setPending(true);
    try {
      const updatedSession = await updateAccountProfile(profile);
      replaceSession(updatedSession);
      router.replace(safeReturnTo(returnTo));
      router.refresh();
    } catch (reason) {
      if (reason instanceof AuthApiError) {
        if (reason.code === "handle_unavailable") {
          const nextErrors = { handle: "That handle is unavailable. Try another one." };
          setFieldErrors(nextErrors);
          queueFirstInvalidField(nextErrors);
        } else if (reason.status === 401) {
          setFormError("Your session expired. Sign in again to finish account setup.");
        } else if (reason.code === "validation_error") {
          const nextErrors: FieldErrors = {};
          for (const issue of reason.issues) {
            if (issue.location.at(-1) === "handle") {
              nextErrors.handle = issue.message;
            }
            if (issue.location.at(-1) === "display_name") {
              nextErrors.displayName = issue.message;
            }
          }
          setFieldErrors(nextErrors);
          if (!Object.keys(nextErrors).length) {
            setFormError("Check your account details and try again.");
          } else {
            queueFirstInvalidField(nextErrors);
          }
        } else {
          setFormError("We couldn’t save your account details. Please try again.");
        }
      } else {
        setFormError("We couldn’t save your account details. Please try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      className="profile-form account-profile-form"
      noValidate
      aria-busy={pending}
      onSubmit={handleSubmit}
    >
      <div className="profile-form__field">
        <label htmlFor="display-name">Display name</label>
        <p id="display-name-help">The name for your Recipe Lab account.</p>
        <input
          id="display-name"
          ref={displayNameRef}
          name="display_name"
          type="text"
          autoComplete="name"
          maxLength={120}
          value={displayName}
          aria-invalid={Boolean(fieldErrors.displayName)}
          aria-describedby={`display-name-help${fieldErrors.displayName ? " display-name-error" : ""}`}
          disabled={pending}
          onChange={(event) => setDisplayName(event.target.value)}
        />
        {fieldErrors.displayName ? (
          <p id="display-name-error" className="profile-form__error">
            {fieldErrors.displayName}
          </p>
        ) : null}
      </div>

      <div className="profile-form__field">
        <label htmlFor="handle">Handle</label>
        <p id="handle-help">
          Your unique account handle. Use 3–30 lowercase letters, numbers, underscores, or hyphens.
        </p>
        <div className="profile-form__handle">
          <span aria-hidden="true">@</span>
          <input
            id="handle"
            ref={handleRef}
            name="handle"
            type="text"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            minLength={3}
            maxLength={30}
            pattern="[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])"
            value={handle}
            aria-invalid={Boolean(fieldErrors.handle)}
            aria-describedby={`handle-help${fieldErrors.handle ? " handle-error" : ""}`}
            disabled={pending}
            onChange={(event) => setHandle(event.target.value.toLocaleLowerCase())}
          />
        </div>
        {fieldErrors.handle ? (
          <p id="handle-error" className="profile-form__error">
            {fieldErrors.handle}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p className="profile-form__alert" role="alert">
          {formError}{" "}
          {formError.startsWith("Your session expired") ? (
            <Link href={`/sign-in?return_to=${encodeURIComponent("/onboarding")}`}>
              Sign in again
            </Link>
          ) : null}
        </p>
      ) : null}

      <div className="button-row profile-form__actions">
        <LoadingButton
          className="button button--primary"
          type="submit"
          pending={pending}
          pendingLabel="Saving account…"
        >
          Finish account setup
        </LoadingButton>
        <Link className="button button--secondary" href="/recipes">
          Finish later
        </Link>
      </div>
    </form>
  );
}

export function OnboardingForm({ returnTo }: OnboardingFormProps) {
  const router = useRouter();
  const { state, refreshSession } = useAuthSession();

  useEffect(() => {
    if (state.phase === "ready" && state.session.status === "authenticated") {
      router.replace(safeReturnTo(returnTo));
    }
  }, [returnTo, router, state]);

  if (state.phase === "loading") {
    return (
      <AuthGateLoading
        className="auth-state account-access-state account-access-state--loading"
        exitHref="/recipes"
        label="Checking your account…"
      />
    );
  }

  if (state.phase === "error") {
    return (
      <div
        className="auth-state account-access-state account-access-state--error"
        role="alert"
      >
        <strong>We couldn’t check your account.</strong>
        <p>Public recipes are still available while you try again.</p>
        <button className="button button--secondary" onClick={() => void refreshSession()}>
          Try again
        </button>
      </div>
    );
  }

  if (state.session.status === "anonymous") {
    return (
      <div
        className="auth-state account-access-state account-access-state--error"
        role="alert"
      >
        <strong>Sign in to finish account setup.</strong>
        <p>Your account session may have expired.</p>
        <Link
          className="button button--primary"
          href={`/sign-in?return_to=${encodeURIComponent("/onboarding")}`}
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (state.session.status === "authenticated") {
    return (
      <div
        className="auth-state account-access-state account-access-state--complete"
        role="status"
      >
        <strong>Your account setup is complete.</strong>
        <p>Taking you back to Recipe Lab…</p>
      </div>
    );
  }

  return (
    <ProfileFields
      key={state.session.user.id}
      returnTo={returnTo}
      session={state.session}
    />
  );
}
