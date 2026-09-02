import type { Metadata } from "next";
import Link from "next/link";
import { Pencil } from "lucide-react";

import { safeReturnTo, signInHref } from "../../lib/auth-api";
import { BranchIcon, HeartIcon } from "../components/recipe-action-icons";
import { RecipeArtwork } from "../components/recipe-artwork";

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
        <aside className="sign-in-visual" aria-label="Why sign in">
          <RecipeArtwork
            className="sign-in-visual__artwork"
            recipeKey="sign-in-0"
          />
          <div className="sign-in-visual__copy">
            <strong>Your recipes, saved for later.</strong>
            <p>
              Sign in when you want to save, adapt, publish, or come back to
              something you&apos;re cooking.
            </p>
          </div>
        </aside>

        <div className="sign-in-card__content">
          <p className="eyebrow">Recipe Lab account</p>
          <h1 id="sign-in-title">Sign in to Recipe Lab</h1>
          <p className="lede">
            Continue to secure sign-in, then you&apos;ll continue where you left off.
          </p>

          <ul className="sign-in-benefits" aria-label="Account benefits">
            <li>
              <span className="sign-in-benefits__icon">
                <HeartIcon />
              </span>
              <span>
                <strong>Save recipes</strong>
                <small>Keep recipes you want to cook again.</small>
              </span>
            </li>
            <li>
              <span className="sign-in-benefits__icon">
                <BranchIcon />
              </span>
              <span>
                <strong>Make your own versions</strong>
                <small>Edit recipes privately and publish when you&apos;re ready.</small>
              </span>
            </li>
            <li>
              <span className="sign-in-benefits__icon">
                <Pencil aria-hidden="true" />
              </span>
              <span>
                <strong>Keep private drafts</strong>
                <small>Come back to changes without losing your work.</small>
              </span>
            </li>
          </ul>

          <div className="auth-card__actions sign-in-card__actions">
            <a
              aria-label="Continue to sign in"
              className="button button--primary"
              href={signInHref(returnTo)}
            >
              <span aria-hidden="true">Continue to secure sign in</span>
              <span aria-hidden="true">→</span>
            </a>
            <Link className="button button--secondary" href="/recipes">
              Keep browsing
            </Link>
          </div>

          <div className="auth-card__fine-print sign-in-security-note">
            <span className="sign-in-security-note__icon" aria-hidden="true">
              ✓
            </span>
            <p>
              <strong>Recipe Lab doesn&apos;t collect your password on this page.</strong>{" "}
              Sign-in is handled by our secure identity provider, and you&apos;ll return
              to Recipe Lab when you&apos;re done.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}
