import type { Metadata } from "next";

import { safeReturnTo } from "../../../lib/auth-api";
import { CallbackStatus } from "./callback-status";

export const metadata: Metadata = {
  title: "Finishing sign-in",
};

interface AuthCallbackPageProps {
  searchParams: Promise<{
    error?: string | string[];
    return_to?: string | string[];
  }>;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AuthCallbackPage({ searchParams }: AuthCallbackPageProps) {
  const query = await searchParams;

  return (
    <main
      id="main-content"
      className="auth-page account-access-page account-access-page--callback"
    >
      <section
        className="auth-card account-access-card account-access-card--callback"
        aria-labelledby="callback-title"
      >
        <p className="eyebrow">Your account</p>
        <h1 id="callback-title">Connecting your account</h1>
        <CallbackStatus
          errorCode={firstValue(query.error)}
          returnTo={safeReturnTo(firstValue(query.return_to))}
        />
      </section>
    </main>
  );
}
