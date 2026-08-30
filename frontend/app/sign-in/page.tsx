import type { Metadata } from "next";
import Link from "next/link";

import { safeReturnTo, signInHref } from "../../lib/auth-api";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in securely to set up your Recipe Lab account.",
};

interface SignInPageProps {
  searchParams: Promise<{ return_to?: string | string[] }>;
}

export default async function SignInPage({ searchParams }: SignInPageProps) {
  const query = await searchParams;
  const requestedReturnTo = Array.isArray(query.return_to)
    ? query.return_to[0]
    : query.return_to;
  const returnTo = safeReturnTo(requestedReturnTo);

  return (
    <main
      id="main-content"
      className="auth-page account-access-page account-access-page--sign-in"
    >
      <section
        className="auth-card account-access-card account-access-card--sign-in"
        aria-labelledby="sign-in-title"
      >
        <p className="eyebrow">Your account</p>
        <h1 id="sign-in-title">Sign in to Recipe Lab</h1>
        <p className="lede">
          Sign in to save and rate recipes, create your own versions, and keep private drafts
          tied to your account. You can still browse every public recipe without an account.
        </p>
        <div className="button-row auth-card__actions">
          <a className="button button--primary" href={signInHref(returnTo)}>
            Continue to sign in
          </a>
          <Link className="button button--secondary" href="/recipes">
            Keep browsing
          </Link>
        </div>
        <p className="auth-card__fine-print">
          Sign-in credentials are handled by the identity provider. Recipe Lab receives only
          the account identity needed to set up your account.
        </p>
      </section>
    </main>
  );
}
