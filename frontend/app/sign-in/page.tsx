import type { Metadata } from "next";

import { safeReturnTo } from "../../features/auth/auth-api";
import { SignInAccess } from "../../features/auth/sign-in-access";
import { SignInRoute } from "../../features/auth/sign-in-route";
import { RecipeArtwork } from "../../features/recipes/shared/recipe-artwork";

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
    <SignInRoute returnTo={returnTo}>
      <main
        id="main-content"
        className="auth-page account-access-page account-access-page--sign-in"
      >
        <section
          className="auth-card account-access-card account-access-card--sign-in"
          aria-label="Recipe Lab account access"
        >
          <SignInAccess
            artwork={<RecipeArtwork
              className="sign-in-visual__artwork"
              recipeKey="sign-in-0"
            />}
            returnTo={returnTo}
          />
        </section>
      </main>
    </SignInRoute>
  );
}
