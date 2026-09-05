import { AuthGateLoading } from "../components/loading-ui";

export default function OnboardingLoading() {
  return (
    <main
      id="main-content"
      className="auth-page account-access-page account-access-page--onboarding"
    >
      <AuthGateLoading
        className="auth-card auth-state account-access-card account-access-state account-access-state--loading"
        label="Opening account setup…"
      />
    </main>
  );
}
