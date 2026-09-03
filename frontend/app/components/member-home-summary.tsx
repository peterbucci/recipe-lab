"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchMemberDashboard,
  MemberActivityApiError,
  type MemberDashboard,
} from "../../lib/member-activity-api";
import type { RecipeDraftListItem } from "../../lib/recipe-draft-api";
import { relativeTimeLabel } from "../../lib/relative-time";
import { LoadingBlock, SectionLoading } from "./loading-ui";
import { MemberActivityIcon } from "./member-activity-icon";
import { useHomeLoadIssue } from "./home-load-state";
import { RecipeArtwork } from "./recipe-artwork";

interface MemberHomeSummaryProps {
  userId: string;
}

type DashboardState =
  | { phase: "loading" }
  | { data: MemberDashboard; phase: "ready" }
  | { message: string; phase: "error"; reportAsHomeIssue: boolean };

interface StoredDashboardState {
  state: DashboardState;
  userId: string;
}

function loadDashboard(signal: AbortSignal): Promise<MemberDashboard> {
  return fetchMemberDashboard(signal);
}

function dashboardError(
  reason: unknown,
): Extract<DashboardState, { phase: "error" }> {
  if (reason instanceof MemberActivityApiError) {
    return {
      message: reason.message,
      phase: "error",
      reportAsHomeIssue: reason.status !== 401 && reason.status !== 403,
    };
  }
  return {
    message: "Recipe Lab could not load your account summary. Please try again.",
    phase: "error",
    reportAsHomeIssue: true,
  };
}

function useMemberDashboard(userId: string): {
  retry: () => void;
  state: DashboardState;
} {
  const requestSequenceRef = useRef(0);
  const [reload, setReload] = useState(0);
  const [stored, setStored] = useState<StoredDashboardState>({
    state: { phase: "loading" },
    userId,
  });

  useEffect(() => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const controller = new AbortController();

    void loadDashboard(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted && sequence === requestSequenceRef.current) {
          setStored({ state: { data, phase: "ready" }, userId });
        }
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
        setStored({ state: dashboardError(reason), userId });
      });

    return () => controller.abort();
  }, [reload, userId]);

  const retry = useCallback(() => {
    requestSequenceRef.current += 1;
    setStored({ state: { phase: "loading" }, userId });
    setReload((current) => current + 1);
  }, [userId]);

  return {
    retry,
    state: stored.userId === userId ? stored.state : { phase: "loading" },
  };
}

function ResourceMetric({
  href,
  label,
  linkLabel,
  state,
  total,
}: {
  href: string;
  label: string;
  linkLabel?: string;
  state: DashboardState;
  total: (data: MemberDashboard) => number;
}) {
  return (
    <div className="member-home-summary__metric">
      <dt>{label}</dt>
      <dd>
        {state.phase === "loading" ? (
          <span>
            <span className="visually-hidden">{label} loading</span>
            <LoadingBlock className="loading-block--small" />
          </span>
        ) : state.phase === "error" ? (
          <span
            aria-label={`${label} unavailable`}
            className="member-home-summary__metric-unavailable"
            title="Unavailable"
          >
            —
          </span>
        ) : (
          <Link
            aria-label={linkLabel ?? `View ${label.toLowerCase()}`}
            className="member-home-summary__metric-value"
            href={href}
          >
            {total(state.data)}
          </Link>
        )}
      </dd>
    </div>
  );
}

function DraftCard({ draft }: { draft: RecipeDraftListItem }) {
  const edited = relativeTimeLabel(draft.updated_at);
  return (
    <article
      className="member-home-summary__draft"
      aria-labelledby={`member-home-draft-${draft.id}`}
    >
      <div className="member-home-summary__draft-preview">
        <RecipeArtwork
          className="member-home-summary__draft-thumbnail"
          recipeKey={draft.id}
        />
        <div className="member-home-summary__draft-copy">
          <h3 id={`member-home-draft-${draft.id}`}>
            {draft.title.trim() || "Untitled recipe"}
          </h3>
          <span>{draft.source_version_id ? "Forked recipe" : "Original recipe"}</span>
          <small>
            Edited{" "}
            <time dateTime={draft.updated_at} title={edited?.absoluteLabel}>
              {edited?.relativeLabel ?? "recently"}
            </time>
          </small>
        </div>
      </div>
      <p className="member-home-summary__draft-counts">
        {draft.ingredient_count} ingredient{draft.ingredient_count === 1 ? "" : "s"}
        {" · "}
        {draft.instruction_count} step{draft.instruction_count === 1 ? "" : "s"}
      </p>
      <Link className="button button--primary" href={`/recipes/drafts/${draft.id}`}>
        Open draft
      </Link>
    </article>
  );
}

function ContinueDraftPanel({ state }: { state: DashboardState }) {
  const draft = state.phase === "ready" ? state.data.latestDraft : null;
  if (state.phase === "ready" && draft === null) return null;

  return (
    <section
      className="member-home-summary__panel member-home-summary__continue"
      aria-labelledby="member-home-continue-title"
    >
      <h2 id="member-home-continue-title">Continue where you left off</h2>
      {state.phase === "loading" ? (
        <SectionLoading
          className="member-home-summary__resource-state"
          count={1}
          label="Loading your latest draft…"
          layout="summary"
        />
      ) : state.phase === "error" ? (
        <p className="member-home-summary__resource-state">Latest draft unavailable.</p>
      ) : draft !== null ? (
        <DraftCard draft={draft} />
      ) : (
        null
      )}
    </section>
  );
}

export function MemberHomeSummary({ userId }: MemberHomeSummaryProps) {
  const dashboard = useMemberDashboard(userId);
  useHomeLoadIssue({
    active:
      dashboard.state.phase === "error" && dashboard.state.reportAsHomeIssue,
    id: "member-summary",
    retry: dashboard.retry,
  });

  const activities =
    dashboard.state.phase === "ready" ? dashboard.state.data.recentActivity : [];

  return (
    <div className="member-home-summary">
      <ContinueDraftPanel state={dashboard.state} />

      <section
        className="member-home-summary__panel member-home-summary__activity"
        aria-labelledby="member-home-activity-title"
      >
        <h2 id="member-home-activity-title">Your activity</h2>
        {activities.length > 0 ? (
          <ol
            className="member-home-summary__activity-list"
            aria-label="Recent account activity"
          >
            {activities.map((activity) => {
              const occurred = relativeTimeLabel(activity.timestamp);
              return (
                <li key={activity.id}>
                  <span className="member-home-summary__activity-icon">
                    <MemberActivityIcon kind={activity.kind} />
                  </span>
                  <div className="member-home-summary__activity-copy">
                    <Link href={activity.href}>
                      <span>{activity.label}</span>
                      <strong>{activity.title}</strong>
                    </Link>
                    <time
                      dateTime={activity.timestamp}
                      title={occurred?.absoluteLabel}
                    >
                      {occurred?.relativeLabel ?? "Recently"}
                    </time>
                  </div>
                </li>
              );
            })}
          </ol>
        ) : dashboard.state.phase === "ready" ? (
          <p>No recent account activity yet.</p>
        ) : dashboard.state.phase === "error" ? (
          <p className="member-home-summary__activity-state">Unavailable.</p>
        ) : (
          <SectionLoading
            className="member-home-summary__activity-state"
            count={3}
            label="Loading recent activity…"
            layout="rows"
          />
        )}
        <Link className="member-home-summary__view-all" href="/account/activity">
          View all activity <span aria-hidden="true">→</span>
        </Link>
      </section>

      <section
        className="member-home-summary__panel member-home-summary__stats"
        aria-labelledby="member-home-stats-title"
      >
        <h2 id="member-home-stats-title">Your stats</h2>
        <dl className="member-home-summary__metrics">
          <ResourceMetric
            href="/account/recipes?view=published"
            label="Versions published"
            linkLabel="View published versions"
            state={dashboard.state}
            total={(data) => data.stats.versionsPublished}
          />
          <ResourceMetric
            href="/account/recipes?view=drafts"
            label="Active drafts"
            state={dashboard.state}
            total={(data) => data.stats.activeDrafts}
          />
          <ResourceMetric
            href="/account/recipes?view=saved"
            label="Saved recipes"
            state={dashboard.state}
            total={(data) => data.stats.savedRecipes}
          />
          <ResourceMetric
            href="/account/followers"
            label="Followers"
            state={dashboard.state}
            total={(data) => data.stats.followers}
          />
        </dl>
      </section>
    </div>
  );
}
