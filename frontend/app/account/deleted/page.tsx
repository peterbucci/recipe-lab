import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Account deleted",
  description: "Your Recipe Lab account was deleted.",
};

export default function AccountDeletedPage() {
  return (
    <main id="main-content" className="state-page">
      <section className="empty-state empty-state--large" aria-labelledby="account-deleted-title">
        <p className="eyebrow">Account deleted</p>
        <h1 id="account-deleted-title">Your account has been deleted.</h1>
        <p>
          Your private account data was removed and your sessions were signed out. Published
          recipe history remains attributed to Deleted cook.
        </p>
        <Link className="button button--primary" href="/recipes">Browse recipes</Link>
      </section>
    </main>
  );
}
