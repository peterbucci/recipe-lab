import type { Metadata } from "next";

import { safeReturnTo } from "../../lib/auth-api";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = {
  title: "Finish account setup",
  description: "Choose a name and reserve a unique handle for your Recipe Lab account.",
};

interface OnboardingPageProps {
  searchParams: Promise<{ return_to?: string | string[] }>;
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const query = await searchParams;
  const requestedReturnTo = Array.isArray(query.return_to)
    ? query.return_to[0]
    : query.return_to;

  return (
    <main id="main-content" className="auth-page">
      <section className="auth-card" aria-labelledby="onboarding-title">
        <p className="eyebrow">One last step</p>
        <h1 id="onboarding-title">Finish account setup</h1>
        <p className="lede">
          Choose a name for your account and reserve a unique account handle. Your saves,
          ratings, and recipe versions will stay with this account.
        </p>
        <OnboardingForm returnTo={safeReturnTo(requestedReturnTo)} />
      </section>
    </main>
  );
}
