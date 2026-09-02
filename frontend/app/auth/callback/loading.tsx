import { AuthGateLoading } from "../../components/loading-ui";

export default function AuthCallbackLoading() {
  return (
    <main
      id="main-content"
      className="auth-page account-access-page account-access-page--callback"
    >
      <AuthGateLoading
        className="auth-card auth-state account-access-card account-access-state account-access-state--loading"
        label="Finishing sign-in…"
      />
    </main>
  );
}
