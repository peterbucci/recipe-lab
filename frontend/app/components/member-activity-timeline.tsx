"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  fetchMemberActivity,
  type MemberActivityCounts,
  type MemberActivityFilter,
} from "../../lib/member-activity-api";
import type { MemberActivity } from "../../lib/member-activity";
import { relativeTimeLabel } from "../../lib/relative-time";
import { useAuthSession } from "./auth-session-provider";
import { LoadingButton, SectionLoading } from "./loading-ui";
import { MemberActivityIcon } from "./member-activity-icon";
import { MemberRouteGate } from "./member-route-gate";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspacePanelHeader } from "./workspace-panel-header";

const ACTIVITY_PAGE_SIZE = 24;
const EMPTY_ACTIVITIES: MemberActivity[] = [];
const EMPTY_COUNTS: MemberActivityCounts = {
  all: 0,
  recipes: 0,
  requests: 0,
  saved: 0,
};

type ActivityDayGroup = "Earlier" | "Today" | "Yesterday";

const ACTIVITY_FILTERS: Array<{
  description: string;
  emptyActionHref: string;
  emptyActionLabel: string;
  emptyDescription: string;
  emptyTitle: string;
  id: MemberActivityFilter;
  label: string;
  title: string;
}> = [
  {
    description: "Recipes, saves, and ingredient requests you’ve worked with recently.",
    emptyActionHref: "/recipes",
    emptyActionLabel: "Explore recipes",
    emptyDescription: "Recipes, saves, and ingredient requests you work with will appear here.",
    emptyTitle: "You have no activity yet.",
    id: "all",
    label: "All",
    title: "All activity",
  },
  {
    description: "Drafts, publications, and withdrawn recipes you’ve worked on.",
    emptyActionHref: "/recipes/new",
    emptyActionLabel: "Start a new recipe",
    emptyDescription: "Start a recipe or publish a version to see that activity here.",
    emptyTitle: "You have no recipe activity yet.",
    id: "recipes",
    label: "Recipes",
    title: "Recipe activity",
  },
  {
    description: "Recipes you’ve saved to come back to later.",
    emptyActionHref: "/recipes",
    emptyActionLabel: "Explore recipes",
    emptyDescription: "Save a public recipe and that activity will appear here.",
    emptyTitle: "You have no saved activity yet.",
    id: "saved",
    label: "Saved",
    title: "Saved activity",
  },
  {
    description: "Ingredient requests that were reviewed by a curator.",
    emptyActionHref: "/account/ingredient-requests",
    emptyActionLabel: "View ingredient requests",
    emptyDescription: "Ingredient requests will appear here after a curator reviews them.",
    emptyTitle: "You have no ingredient request activity yet.",
    id: "requests",
    label: "Ingredient requests",
    title: "Ingredient request activity",
  },
];

type ActivityState =
  | { phase: "loading" }
  | {
      activities: MemberActivity[];
      counts: MemberActivityCounts;
      loadMoreFailed: boolean;
      loadingMore: boolean;
      nextCursor: string | null;
      phase: "ready";
    }
  | { phase: "error"; retrying: boolean };

function activityDetail(activity: MemberActivity): string {
  if (activity.detail) return activity.detail;
  if (activity.kind === "draft") return "Your draft was saved.";
  if (activity.kind === "published") return "Your version became publicly available.";
  if (activity.kind === "saved") return "Added to your saved recipes.";
  if (activity.kind === "withdrawn") return "This recipe is no longer publicly available.";
  return "Your ingredient request was reviewed.";
}

function activityDayGroup(timestamp: string, now = Date.now()): ActivityDayGroup {
  const date = new Date(timestamp);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const startOfToday = today.valueOf();
  const yesterday = new Date(startOfToday);
  yesterday.setDate(yesterday.getDate() - 1);
  const startOfYesterday = yesterday.valueOf();
  const value = date.valueOf();

  if (value >= startOfToday) return "Today";
  if (value >= startOfYesterday) return "Yesterday";
  return "Earlier";
}

function groupActivities(
  activities: MemberActivity[],
): Array<{ label: ActivityDayGroup; activities: MemberActivity[] }> {
  const groups: Record<ActivityDayGroup, MemberActivity[]> = {
    Today: [],
    Yesterday: [],
    Earlier: [],
  };
  for (const activity of activities) {
    groups[activityDayGroup(activity.timestamp)].push(activity);
  }
  return (["Today", "Yesterday", "Earlier"] as const)
    .map((label) => ({ activities: groups[label], label }))
    .filter((group) => group.activities.length > 0);
}

function activityTimeDisplay(
  timestamp: string,
  group: ActivityDayGroup,
  relativeLabel: string,
  now = Date.now(),
): string {
  const date = new Date(timestamp);
  if (group === "Today") return relativeLabel;
  if (group === "Yesterday") {
    return `Yesterday · ${new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date)}`;
  }
  const currentYear = new Date(now).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === currentYear ? {} : { year: "numeric" }),
  }).format(date);
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = globalThis.setTimeout(() => setDebounced(value), delayMs);
    return () => globalThis.clearTimeout(timeout);
  }, [delayMs, value]);
  return debounced;
}

function MemberActivityTimelineInner({ userId }: { userId: string }) {
  const requestSequenceRef = useRef(0);
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<MemberActivityFilter>("all");
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const [state, setState] = useState<ActivityState>({ phase: "loading" });

  useEffect(() => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const controller = new AbortController();
    void fetchMemberActivity({
      filter,
      pageSize: ACTIVITY_PAGE_SIZE,
      q: debouncedQuery,
      signal: controller.signal,
    })
      .then((page) => {
        if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
        setState({
          activities: page.items,
          counts: page.counts,
          loadMoreFailed: false,
          loadingMore: false,
          nextCursor: page.nextCursor,
          phase: "ready",
        });
      })
      .catch(() => {
        if (controller.signal.aborted || sequence !== requestSequenceRef.current) return;
        setState({ phase: "error", retrying: false });
      });
    return () => controller.abort();
  }, [debouncedQuery, filter, reload, userId]);

  const retry = useCallback(() => {
    setState((current) =>
      current.phase === "error" ? { phase: "error", retrying: true } : current,
    );
    setReload((value) => value + 1);
  }, []);

  const loadOlder = useCallback(() => {
    if (state.phase !== "ready" || state.loadingMore || !state.nextCursor) return;
    const sequence = requestSequenceRef.current;
    const cursor = state.nextCursor;
    setState({ ...state, loadMoreFailed: false, loadingMore: true });
    void fetchMemberActivity({
      cursor,
      filter,
      pageSize: ACTIVITY_PAGE_SIZE,
      q: debouncedQuery,
    })
      .then((page) => {
        if (sequence !== requestSequenceRef.current) return;
        setState((current) => {
          if (current.phase !== "ready") return current;
          const existing = new Set(current.activities.map((item) => item.id));
          return {
            activities: [
              ...current.activities,
              ...page.items.filter((item) => !existing.has(item.id)),
            ],
            counts: page.counts,
            loadMoreFailed: false,
            loadingMore: false,
            nextCursor: page.nextCursor,
            phase: "ready",
          };
        });
      })
      .catch(() => {
        if (sequence !== requestSequenceRef.current) return;
        setState((current) =>
          current.phase === "ready"
            ? { ...current, loadMoreFailed: true, loadingMore: false }
            : current,
        );
      });
  }, [debouncedQuery, filter, state]);

  const activities =
    state.phase === "ready" ? state.activities : EMPTY_ACTIVITIES;
  const counts = state.phase === "ready" ? state.counts : EMPTY_COUNTS;
  const activityGroups = useMemo(() => groupActivities(activities), [activities]);
  const activeFilter =
    ACTIVITY_FILTERS.find((item) => item.id === filter) ?? ACTIVITY_FILTERS[0]!;

  return (
    <main id="main-content" className="member-activity-page member-activity-page--timeline">
      <section
        className="member-activity-page__panel"
        aria-labelledby="member-activity-page-title"
      >
        <header className="member-activity-page__heading">
          <div>
            <h1 id="member-activity-page-title">Activity</h1>
            <p>
              A history of the recipes, saves, and ingredient requests you&apos;ve
              worked with recently.
            </p>
          </div>
        </header>

        <section className="member-activity-page__shell" aria-label="Account activity">
          <div className="member-activity-page__toolbar workspace-tab-menu">
            <div
              className="member-activity-page__filters workspace-tab-menu__items"
              aria-label="Activity filters"
              role="group"
            >
              {ACTIVITY_FILTERS.map((item) => (
                <button
                  aria-pressed={filter === item.id}
                  className="member-activity-page__filter workspace-tab-menu__item"
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id !== filter) {
                      setState({ phase: "loading" });
                      setFilter(item.id);
                    }
                  }}
                >
                  {item.label}
                  <span className="workspace-tab-menu__count" aria-hidden="true">
                    {counts[item.id]}
                  </span>
                </button>
              ))}
            </div>
            <label className="member-activity-page__search workspace-tab-menu__search">
              <span className="visually-hidden">Search activity</span>
              <Search aria-hidden="true" />
              <input
                type="search"
                placeholder="Search activity…"
                value={query}
                onChange={(event) => {
                  setState({ phase: "loading" });
                  setQuery(event.target.value);
                }}
              />
            </label>
          </div>
          <WorkspacePanelHeader
            description={activeFilter.description}
            meta={
              <span aria-live="polite">
                {counts[filter]} activity item{counts[filter] === 1 ? "" : "s"}
              </span>
            }
            title={activeFilter.title}
          />

          {state.phase === "loading" ? (
            <SectionLoading
              className="member-activity-page__state"
              count={5}
              label="Loading your activity…"
              layout="rows"
            />
          ) : state.phase === "error" ? (
            <div className="member-activity-page__state form-alert" role="alert">
              <h2>Activity is temporarily unavailable</h2>
              <p>Try again to refresh this page.</p>
              <LoadingButton
                className="button button--primary"
                pending={state.retrying}
                pendingLabel="Trying again…"
                type="button"
                onClick={retry}
              >
                Try again
              </LoadingButton>
            </div>
          ) : activities.length === 0 ? (
            <WorkspaceEmptyState
              action={
                query.trim() ? (
                  <button
                    className="button button--primary"
                    type="button"
                    onClick={() => {
                      setState({ phase: "loading" });
                      setQuery("");
                    }}
                  >
                    Clear search
                  </button>
                ) : (
                  <Link className="button button--primary" href={activeFilter.emptyActionHref}>
                    {activeFilter.emptyActionLabel}
                  </Link>
                )
              }
              description={
                query.trim()
                  ? "Try a different search term or clear the search."
                  : activeFilter.emptyDescription
              }
              eyebrow={query.trim() ? "No matches" : undefined}
              headingId={`empty-activity-${filter}`}
              headingLevel={3}
              title={
                query.trim()
                  ? "No activity matches your search."
                  : activeFilter.emptyTitle
              }
            />
          ) : (
            <div className="member-activity-page__content">
              {activityGroups.map((group) => (
                <section
                  className="member-activity-page__group"
                  key={group.label}
                  aria-labelledby={`activity-group-${group.label.toLowerCase()}`}
                >
                  <h2
                    className="member-activity-page__group-heading"
                    id={`activity-group-${group.label.toLowerCase()}`}
                  >
                    <span>{group.label}</span>
                  </h2>
                  <ol className="member-activity-page__list">
                    {group.activities.map((activity) => {
                      const occurred = relativeTimeLabel(activity.timestamp);
                      return (
                        <li key={activity.id}>
                          <Link className="member-activity-page__event" href={activity.href}>
                            <span
                              className={`member-activity-page__icon member-activity-page__icon--${activity.kind}`}
                            >
                              <MemberActivityIcon kind={activity.kind} />
                            </span>
                            <span className="member-activity-page__copy">
                              <small>{activity.label}</small>
                              <strong>{activity.title}</strong>
                              <span>{activityDetail(activity)}</span>
                            </span>
                            <span className="member-activity-page__when">
                              <time
                                dateTime={activity.timestamp}
                                title={occurred?.absoluteLabel}
                              >
                                {activityTimeDisplay(
                                  activity.timestamp,
                                  group.label,
                                  occurred?.relativeLabel ?? "Recently",
                                )}
                              </time>
                              <ChevronRight aria-hidden="true" />
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ol>
                </section>
              ))}
              {state.loadMoreFailed ? (
                <p className="form-alert" role="alert">
                  Older activity could not be loaded. Try again.
                </p>
              ) : null}
              {state.nextCursor ? (
                <div className="member-activity-page__load-more">
                  <LoadingButton
                    className="button button--secondary"
                    pending={state.loadingMore}
                    pendingLabel="Loading older activity…"
                    type="button"
                    onClick={loadOlder}
                  >
                    Load older activity
                  </LoadingButton>
                </div>
              ) : null}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

export function MemberActivityTimeline() {
  const { state } = useAuthSession();
  const userId =
    state.phase === "ready" && state.session.status === "authenticated"
      ? state.session.user.id
      : null;

  return (
    <MemberRouteGate eyebrow="Your Recipe Lab" returnTo="/account/activity" title="Activity">
      {userId ? <MemberActivityTimelineInner key={userId} userId={userId} /> : null}
    </MemberRouteGate>
  );
}
