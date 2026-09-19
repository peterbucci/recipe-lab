import type { Metadata } from "next";

import { DemoSessionDetails } from "../../../features/auth/demo-session-details";
import { DEMO_SESSION_DETAILS_PATH } from "../../../features/auth/demo-session-route";
import { MemberRouteGate } from "../../../features/auth/member-route-gate";
import { RecipeArtwork } from "../../../features/recipes/shared/recipe-artwork";

export const metadata: Metadata = {
  title: "About your demo account",
  description:
    "Review the Recipe Lab portfolio sandbox privacy, expiry, and contact details.",
};

export default function DemoSessionDetailsPage() {
  return (
    <MemberRouteGate
      returnTo={DEMO_SESSION_DETAILS_PATH}
      signedOutDescription="Start a demo account to review how it works and when its data is deleted."
    >
      <main
        id="main-content"
        className="auth-page account-access-page account-access-page--sign-in demo-session-details-page"
      >
        <section
          className="auth-card account-access-card account-access-card--sign-in demo-session-details-card"
          aria-labelledby="demo-session-details-title"
        >
          <header
            className="sign-in-visual demo-session-details-visual"
          >
            <RecipeArtwork
              className="sign-in-visual__artwork"
              recipeKey="sign-in-0"
            />
            <div className="sign-in-visual__copy demo-session-details-visual__copy">
              <h1 id="demo-session-details-title">Temporary by design</h1>
              <p>
                Your demo account lets you try the full experience without
                creating a permanent account or sharing personal information.
              </p>
            </div>
          </header>

          <div className="sign-in-card__content demo-session-details-card__content">
            <DemoSessionDetails />
          </div>
        </section>
      </main>
    </MemberRouteGate>
  );
}
