"use client";

import Link from "next/link";

export default function AuthCallbackError() {
  return (
    <main id="main-content" className="auth-page">
      <div className="auth-card auth-state" role="alert">
        <strong>Sign-in stopped unexpectedly.</strong>
        <p>Your account and public recipes were not changed.</p>
        <Link className="button button--primary" href="/sign-in">
          Return to sign in
        </Link>
      </div>
    </main>
  );
}
