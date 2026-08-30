import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Community rules",
  description: "The rules for publishing and participating safely in Recipe Lab.",
};

export default function CommunityRulesPage() {
  return (
    <main id="main-content" className="page-shell policy-page public-policy-page">
      <header className="policy-page__header">
        <p className="eyebrow">Recipe Lab community</p>
        <h1>Community rules</h1>
        <p>
          Recipe Lab is a place to share useful recipes, learn from other cooks, and keep clear
          recipe history. These rules apply to every published recipe and member interaction.
        </p>
      </header>
      <div className="policy-page__sections">
        <section aria-labelledby="rules-share">
          <h2 id="rules-share">Share work you have the right to publish</h2>
          <p>
            Publish recipes you created or are allowed to share. Do not copy protected text or
            claim another cook’s work as your own. Versions based on another recipe must keep
            that connection in their recipe history.
          </p>
        </section>
        <section aria-labelledby="rules-safe">
          <h2 id="rules-safe">Keep recipes safe and lawful</h2>
          <p>
            Do not publish instructions intended to cause harm, facilitate illegal activity, or
            knowingly put cooks at risk. Clearly describe food-safety steps when they matter.
          </p>
        </section>
        <section aria-labelledby="rules-respect">
          <h2 id="rules-respect">Treat people with respect</h2>
          <p>
            Harassment, hateful content, threats, targeted abuse, spam, and deliberately misleading
            material are not welcome.
          </p>
        </section>
        <section aria-labelledby="rules-enforcement">
          <h2 id="rules-enforcement">How reports and moderation work</h2>
          <p>
            Signed-in members can privately report a public recipe. Reporter identities and report
            details are not shown to recipe authors or the public. Authorized moderators may hide a
            recipe while it is reviewed, restore it, or resolve the case. Reports do not guarantee a
            particular outcome.
          </p>
        </section>
        <section aria-labelledby="rules-publishing">
          <h2 id="rules-publishing">Your publishing acknowledgement</h2>
          <p>
            Before publishing, you must confirm that you accept these rules and have the right to
            share the recipe. A published version cannot be edited; later changes create a new
            version.
          </p>
        </section>
      </div>
      <div className="button-row policy-page__actions">
        <Link className="button button--primary" href="/recipes">
          Explore recipes
        </Link>
        <Link className="button button--secondary" href="/#how-it-works">
          See how Recipe Lab works
        </Link>
      </div>
    </main>
  );
}
