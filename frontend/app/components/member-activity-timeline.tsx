"use client";

import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { retryTransientRead } from "../../lib/api-transport/transient-read-retry";
import {
  browseMyIngredientRequests,
  type MemberIngredientRequest,
} from "../../lib/ingredient-catalog-api";
import {
  buildMemberActivities,
  type MemberActivity,
} from "../../lib/member-activity";
import {
  fetchMyRecipeLibrary,
  fetchSavedRecipeLibrary,
  type MyRecipeLibraryPage,
  type MyRecipeLibraryView,
  type SavedRecipeLibraryPage,
} from "../../lib/recipe-library-api";
import { relativeTimeLabel } from "../../lib/relative-time";
import { useAuthSession } from "./auth-session-provider";
import { LoadingButton, SectionLoading } from "./loading-ui";
import { MemberActivityIcon } from "./member-activity-icon";
import { MemberRouteGate } from "./member-route-gate";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspacePanelHeader } from "./workspace-panel-header";

const ACTIVITY_PAGE_SIZE = 100;
const INITIAL_VISIBLE_ACTIVITY_COUNT = 12;
const ACTIVITY_PAGE_INCREMENT = 12;
const EMPTY_ACTIVITIES: MemberActivity[] = [];

type ActivityFilter = "all" | "recipes" | "requests" | "saved";
type ActivityDayGroup = "Earlier" | "Today" | "Yesterday";

const ACTIVITY_FILTERS: Array<{
  description: string;
  emptyActionHref: string;
  emptyActionLabel: string;
  emptyDescription: string;
  emptyTitle: string;
  id: ActivityFilter;
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
      hasFailures: boolean;
      phase: "ready";
      retrying: boolean;
    };

interface ActivityLoadResult {
  activities: MemberActivity[];
  hasFailures: boolean;
}

function activityFilterForKind(kind: MemberActivity["kind"]): ActivityFilter {
  if (kind === "saved") return "saved";
  if (kind === "ingredient-request") return "requests";
  return "recipes";
}

function activityDetail(activity: MemberActivity): string {
  if (activity.detail) return activity.detail;
  if (activity.kind === "draft") return "Your draft was saved.";
  if (activity.kind === "published") {
    return "Your version became publicly available.";
  }
  if (activity.kind === "saved") return "Added to your saved recipes.";
  if (activity.kind === "withdrawn") {
    return "This recipe is no longer publicly available.";
  }
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

async function collectLibraryItems(
  view: MyRecipeLibraryView,
  signal: AbortSignal,
): Promise<MyRecipeLibraryPage["items"]> {
  const first = await fetchMyRecipeLibrary({
    page: 1,
    pageSize: ACTIVITY_PAGE_SIZE,
    signal,
    view,
  });
  if (first.total_pages <= 1) return first.items;

  const items = [...first.items];
  for (let page = 2; page <= first.total_pages; page += 1) {
    const next = await fetchMyRecipeLibrary({
      page,
      pageSize: ACTIVITY_PAGE_SIZE,
      signal,
      view,
    });
    items.push(...next.items);
  }
  return items;
}

async function collectSavedItems(
  signal: AbortSignal,
): Promise<SavedRecipeLibraryPage["items"]> {
  const first = await fetchSavedRecipeLibrary({
    page: 1,
    pageSize: ACTIVITY_PAGE_SIZE,
    signal,
  });
  if (first.total_pages <= 1) return first.items;

  const items = [...first.items];
  for (let page = 2; page <= first.total_pages; page += 1) {
    const next = await fetchSavedRecipeLibrary({
      page,
      pageSize: ACTIVITY_PAGE_SIZE,
      signal,
    });
    items.push(...next.items);
  }
  return items;
}

async function collectReviewedRequests(
  signal: AbortSignal,
): Promise<MemberIngredientRequest[]> {
  const first = await retryTransientRead(
    (readSignal) =>
      browseMyIngredientRequests({
        page: 1,
        pageSize: ACTIVITY_PAGE_SIZE,
        reviewedOnly: true,
        signal: readSignal,
      }),
    { signal },
  );
  if (first.total_pages <= 1) return [...first.items];

  const items = [...first.items];
  for (let page = 2; page <= first.total_pages; page += 1) {
    const next = await retryTransientRead(
      (readSignal) =>
        browseMyIngredientRequests({
          page,
          pageSize: ACTIVITY_PAGE_SIZE,
          reviewedOnly: true,
          signal: readSignal,
        }),
      { signal },
    );
    items.push(...next.items);
  }
  return items;
}

async function loadActivities(signal: AbortSignal): Promise<ActivityLoadResult> {
  const results = await Promise.allSettled([
    collectLibraryItems("drafts", signal),
    collectLibraryItems("published", signal),
    collectLibraryItems("withdrawn", signal),
    collectSavedItems(signal),
    collectReviewedRequests(signal),
  ]);
  const [drafts, published, withdrawn, saved, ingredientRequests] = results;

  return {
    activities: buildMemberActivities({
      drafts: drafts.status === "fulfilled" ? { items: drafts.value } : undefined,
      ingredientRequests:
        ingredientRequests.status === "fulfilled"
          ? { items: ingredientRequests.value }
          : undefined,
      published:
        published.status === "fulfilled" ? { items: published.value } : undefined,
      saved: saved.status === "fulfilled" ? { items: saved.value } : undefined,
      withdrawn:
        withdrawn.status === "fulfilled" ? { items: withdrawn.value } : undefined,
    }),
    hasFailures: results.some((result) => result.status === "rejected"),
  };
}

function MemberActivityTimelineInner({ userId }: { userId: string }) {
  const [reload, setReload] = useState(0);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [query, setQuery] = useState("");
  const [visibleCount, setVisibleCount] = useState(
    INITIAL_VISIBLE_ACTIVITY_COUNT,
  );
  const [state, setState] = useState<ActivityState>({ phase: "loading" });
  const retry = useCallback(() => {
    setState((current) =>
      current.phase === "ready" ? { ...current, retrying: true } : current,
    );
    setReload((value) => value + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadActivities(controller.signal)
      .then(({ activities, hasFailures }) => {
        if (!controller.signal.aborted) {
          setState({ activities, hasFailures, phase: "ready", retrying: false });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setState({
            activities: [],
            hasFailures: true,
            phase: "ready",
            retrying: false,
          });
        }
      });
    return () => controller.abort();
  }, [reload, userId]);

  const activities =
    state.phase === "ready" ? state.activities : EMPTY_ACTIVITIES;
  const filterCounts = useMemo(() => {
    const counts: Record<ActivityFilter, number> = {
      all: activities.length,
      recipes: 0,
      requests: 0,
      saved: 0,
    };
    for (const activity of activities) {
      counts[activityFilterForKind(activity.kind)] += 1;
    }
    return counts;
  }, [activities]);
  const matchingActivities = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return activities.filter((activity) => {
      const categoryMatches =
        filter === "all" || activityFilterForKind(activity.kind) === filter;
      if (!categoryMatches) return false;
      if (!normalizedQuery) return true;
      return [activity.label, activity.title, activityDetail(activity)]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [activities, filter, query]);
  const visibleActivities = matchingActivities.slice(0, visibleCount);
  const activityGroups = groupActivities(visibleActivities);
  const activeFilter =
    ACTIVITY_FILTERS.find((item) => item.id === filter) ?? ACTIVITY_FILTERS[0]!;

  const chooseFilter = (nextFilter: ActivityFilter) => {
    setFilter(nextFilter);
    setVisibleCount(INITIAL_VISIBLE_ACTIVITY_COUNT);
  };

  const updateQuery = (value: string) => {
    setQuery(value);
    setVisibleCount(INITIAL_VISIBLE_ACTIVITY_COUNT);
  };

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

        {state.phase === "loading" ? (
          <div className="member-activity-page__shell">
            <div className="member-activity-page__toolbar-placeholder" />
            <WorkspacePanelHeader
              description={activeFilter.description}
              title={activeFilter.title}
            />
            <SectionLoading
              className="member-activity-page__state"
              count={5}
              label="Loading your activity…"
              layout="rows"
            />
          </div>
        ) : (
          <>
            {state.hasFailures ? (
              <div className="form-alert" role="alert">
                <p>
                  Some activity is unavailable right now. Try again to refresh
                  this page.
                </p>
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
            ) : null}

            <section
              className="member-activity-page__shell"
              aria-label="Account activity"
            >
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
                      onClick={() => chooseFilter(item.id)}
                    >
                      {item.label}
                      <span className="workspace-tab-menu__count" aria-hidden="true">
                        {filterCounts[item.id]}
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
                    onChange={(event) => updateQuery(event.target.value)}
                  />
                </label>
              </div>
              <WorkspacePanelHeader
                description={activeFilter.description}
                meta={
                  <span aria-live="polite">
                    {filterCounts[filter]} activity item
                    {filterCounts[filter] === 1 ? "" : "s"}
                  </span>
                }
                title={activeFilter.title}
              />

              {matchingActivities.length === 0 ? (
                state.hasFailures && activities.length === 0 ? (
                  <div className="member-activity-page__state">
                    <h2>Activity is temporarily unavailable</h2>
                    <p>Try again using the button above.</p>
                  </div>
                ) : (
                  <WorkspaceEmptyState
                    action={
                      query.trim() ? (
                        <button
                          className="button button--primary"
                          type="button"
                          onClick={() => setQuery("")}
                        >
                          Clear search
                        </button>
                      ) : (
                        <Link
                          className="button button--primary"
                          href={activeFilter.emptyActionHref}
                        >
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
                )
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
                              <Link
                                className="member-activity-page__event"
                                href={activity.href}
                              >
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
                  {matchingActivities.length > visibleCount ? (
                    <div className="member-activity-page__load-more">
                      <button
                        className="button button--secondary"
                        type="button"
                        onClick={() =>
                          setVisibleCount(
                            (current) => current + ACTIVITY_PAGE_INCREMENT,
                          )
                        }
                      >
                        Load older activity
                      </button>
                    </div>
                  ) : null}
                </div>
              )}
            </section>
          </>
        )}
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
    <MemberRouteGate
      eyebrow="Your Recipe Lab"
      returnTo="/account/activity"
      title="Activity"
    >
      {userId ? (
        <MemberActivityTimelineInner key={userId} userId={userId} />
      ) : null}
    </MemberRouteGate>
  );
}
