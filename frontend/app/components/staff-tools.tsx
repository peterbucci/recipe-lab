"use client";

import { type KeyboardEvent, useRef, useState } from "react";

import { useAuthSession } from "./auth-session-provider";
import { AuthGateLoading } from "./loading-ui";
import { GuardedLink } from "./navigation-blocker-provider";
import { WorkspacePanelHeader } from "./workspace-panel-header";

const STAFF_PATH = "/staff";

type StaffRole = "curator" | "moderator";

interface AuthorizedStaffToolsProps {
  canReviewIngredients: boolean;
  canModerateRecipes: boolean;
}

function AuthorizedStaffTools({
  canReviewIngredients,
  canModerateRecipes,
}: AuthorizedStaffToolsProps) {
  const availableRoles: StaffRole[] = [];
  if (canReviewIngredients) {
    availableRoles.push("curator");
  }
  if (canModerateRecipes) {
    availableRoles.push("moderator");
  }

  const firstAvailableRole: StaffRole = canReviewIngredients ? "curator" : "moderator";
  const [requestedActiveRole, setRequestedActiveRole] = useState<StaffRole>(firstAvailableRole);
  const activeRole = availableRoles.includes(requestedActiveRole)
    ? requestedActiveRole
    : firstAvailableRole;
  const tabRefs = useRef<Record<StaffRole, HTMLButtonElement | null>>({
    curator: null,
    moderator: null,
  });

  const handleTabKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentRole: StaffRole,
  ) => {
    const currentIndex = availableRoles.indexOf(currentRole);
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % availableRoles.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + availableRoles.length) % availableRoles.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = availableRoles.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextRole = availableRoles[nextIndex];
    setRequestedActiveRole(nextRole);
    tabRefs.current[nextRole]?.focus();
  };

  return (
    <main id="main-content" className="page-shell staff-tools-page">
      <header className="page-intro staff-tools__intro">
        <h1>Staff Tools</h1>
        <p>Open the staff tools available to your account.</p>
      </header>

      <section className="staff-tools__shell">
        <div
          className="staff-tools__role-tabs workspace-tab-menu workspace-tab-menu--items-only"
          role="tablist"
          aria-label="Staff tool categories"
        >
          {canReviewIngredients ? (
            <button
              ref={(node) => {
                tabRefs.current.curator = node;
              }}
              id="staff-curator-tab"
              className="staff-tools__role-tab workspace-tab-menu__item"
              type="button"
              role="tab"
              aria-controls="staff-curator-panel"
              aria-selected={activeRole === "curator"}
              tabIndex={activeRole === "curator" ? 0 : -1}
              onClick={() => setRequestedActiveRole("curator")}
              onKeyDown={(event) => handleTabKeyDown(event, "curator")}
            >
              Curator tools
              <span
                className="staff-tools__role-count workspace-tab-menu__count"
                aria-hidden="true"
              >
                1
              </span>
            </button>
          ) : null}
          {canModerateRecipes ? (
            <button
              ref={(node) => {
                tabRefs.current.moderator = node;
              }}
              id="staff-moderator-tab"
              className="staff-tools__role-tab workspace-tab-menu__item"
              type="button"
              role="tab"
              aria-controls="staff-moderator-panel"
              aria-selected={activeRole === "moderator"}
              tabIndex={activeRole === "moderator" ? 0 : -1}
              onClick={() => setRequestedActiveRole("moderator")}
              onKeyDown={(event) => handleTabKeyDown(event, "moderator")}
            >
              Moderator tools
              <span
                className="staff-tools__role-count workspace-tab-menu__count"
                aria-hidden="true"
              >
                1
              </span>
            </button>
          ) : null}
        </div>

        {canReviewIngredients ? (
          <section
            id="staff-curator-panel"
            className="staff-tools__panel"
            role="tabpanel"
            aria-labelledby="staff-curator-tab"
            hidden={activeRole !== "curator"}
          >
            <WorkspacePanelHeader
              description="Maintain trusted catalog data used by recipe editors."
              meta={<span>Curator access</span>}
              title="Curator tools"
            />

            <div className="staff-tools__tool-list">
              <article className="staff-tools__tool-row">
                <span
                  className="staff-tools__tool-icon staff-tools__tool-icon--curator"
                  aria-hidden="true"
                >
                  ◇
                </span>
                <div className="staff-tools__tool-copy">
                  <h3>Ingredient catalog</h3>
                  <p>
                    Review missing-ingredient requests and decide whether to approve them, reject
                    them, or resolve them to an existing ingredient.
                  </p>
                  <small>
                    Controls which ingredient identities become available in recipe editors.
                  </small>
                </div>
                <GuardedLink
                  className="button button--secondary staff-tools__tool-action"
                  href="/catalog/ingredient-requests"
                  aria-label="Open ingredient catalog"
                >
                  Open catalog
                </GuardedLink>
              </article>
            </div>

          </section>
        ) : null}

        {canModerateRecipes ? (
          <section
            id="staff-moderator-panel"
            className="staff-tools__panel"
            role="tabpanel"
            aria-labelledby="staff-moderator-tab"
            hidden={activeRole !== "moderator"}
          >
            <WorkspacePanelHeader
              description="Review community reports and public-content visibility."
              meta={<span>Moderator access</span>}
              title="Moderator tools"
            />

            <div className="staff-tools__tool-list">
              <article className="staff-tools__tool-row">
                <span
                  className="staff-tools__tool-icon staff-tools__tool-icon--moderator"
                  aria-hidden="true"
                >
                  !
                </span>
                <div className="staff-tools__tool-copy">
                  <h3>Recipe reports</h3>
                  <p>
                    Review reports submitted against public recipes and record the appropriate
                    moderation decision.
                  </p>
                  <small>Moderator access does not grant ingredient-catalog permissions.</small>
                </div>
                <GuardedLink
                  className="button button--secondary staff-tools__tool-action"
                  href="/moderation/recipes"
                  aria-label="Open recipe reports"
                >
                  Open reports
                </GuardedLink>
              </article>
            </div>

          </section>
        ) : null}
      </section>
    </main>
  );
}

export function StaffTools() {
  const { state, refreshSession } = useAuthSession();

  if (state.phase === "loading") {
    return (
      <main id="main-content" className="state-page staff-tools-page">
        <AuthGateLoading label="Checking staff access…" />
      </main>
    );
  }

  if (state.phase === "error") {
    return (
      <main id="main-content" className="state-page staff-tools-page">
        <div className="error-state" role="alert">
          <p className="eyebrow">Staff tools unavailable</p>
          <h1>We couldn’t check your access.</h1>
          <p>Try the account check again before opening a staff workspace.</p>
          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              onClick={() => void refreshSession()}
            >
              Try again
            </button>
            <GuardedLink className="button button--secondary" href="/recipes">
              Browse recipes
            </GuardedLink>
          </div>
        </div>
      </main>
    );
  }

  if (state.session.status === "anonymous") {
    return (
      <main id="main-content" className="auth-page staff-tools-page">
        <section className="auth-card" aria-labelledby="staff-sign-in-title">
          <p className="eyebrow">Staff tools</p>
          <h1 id="staff-sign-in-title">Sign in to open staff tools.</h1>
          <p className="lede">Your account must have an active staff role to continue.</p>
          <div className="button-row auth-card__actions">
            <GuardedLink
              className="button button--primary"
              href={`/sign-in?${new URLSearchParams({ return_to: STAFF_PATH }).toString()}`}
            >
              Sign in to continue
            </GuardedLink>
            <GuardedLink className="button button--secondary" href="/recipes">
              Browse recipes
            </GuardedLink>
          </div>
        </section>
      </main>
    );
  }

  if (state.session.status === "onboarding_required") {
    return (
      <main id="main-content" className="auth-page staff-tools-page">
        <section className="auth-card" aria-labelledby="staff-onboarding-title">
          <p className="eyebrow">Staff tools</p>
          <h1 id="staff-onboarding-title">Finish setting up your account.</h1>
          <p className="lede">Complete your profile before opening a staff workspace.</p>
          <GuardedLink
            className="button button--primary"
            href={`/onboarding?${new URLSearchParams({ return_to: STAFF_PATH }).toString()}`}
          >
            Finish account setup
          </GuardedLink>
        </section>
      </main>
    );
  }

  const canReviewIngredients = Boolean(
    state.session.capabilities?.review_ingredient_requests,
  );
  const canModerateRecipes = Boolean(
    state.session.capabilities?.moderate_recipe_reports,
  );

  if (canReviewIngredients || canModerateRecipes) {
    return (
      <AuthorizedStaffTools
        canReviewIngredients={canReviewIngredients}
        canModerateRecipes={canModerateRecipes}
      />
    );
  }

  return (
    <main id="main-content" className="page-shell staff-tools-page">
      <header className="page-intro staff-tools__intro">
        <h1>Staff Tools</h1>
        <p>Open the staff tools available to your account.</p>
      </header>
      <section className="empty-state staff-tools__empty" aria-labelledby="staff-empty-title">
        <p className="eyebrow">No staff role</p>
        <h2 id="staff-empty-title">No staff tools are assigned to this account.</h2>
        <p>Your recipes and account are still available from the regular member navigation.</p>
        <GuardedLink className="button button--primary" href="/account/recipes?view=drafts">
          Go to My recipes
        </GuardedLink>
      </section>
    </main>
  );
}
