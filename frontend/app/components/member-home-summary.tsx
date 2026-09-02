"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { retryTransientRead } from "../../lib/api-transport/transient-read-retry";
import {
  browseMyIngredientRequests,
  IngredientCatalogApiError,
  type MemberIngredientRequest,
} from "../../lib/ingredient-catalog-api";
import {
  fetchMyFollowStats,
  MemberFollowApiError,
  type MyFollowStats,
} from "../../lib/member-follow-api";
import type { RecipeDraftListItem } from "../../lib/recipe-draft-api";
import {
  fetchMyRecipeLibrary,
  fetchSavedRecipeLibrary,
  type MyRecipeLibraryPage,
  RecipeLibraryApiError,
  type SavedRecipeLibraryPage,
} from "../../lib/recipe-library-api";
import { buildMemberActivities } from "../../lib/member-activity";
import { relativeTimeLabel } from "../../lib/relative-time";
import { LoadingBlock, SectionLoading } from "./loading-ui";
import { MemberActivityIcon } from "./member-activity-icon";
import { useHomeLoadIssue } from "./home-load-state";
import { RecipeArtwork } from "./recipe-artwork";

interface MemberHomeSummaryProps {
  userId: string;
}

type ResourceState<T> =
  | { phase: "loading" }
  | { data: T; phase: "ready" }
  | { message: string; phase: "error"; reportAsHomeIssue: boolean };

interface StoredResourceState<T> {
  state: ResourceState<T>;
  userId: string;
}

interface MemberHomeResource<T> {
  retry: () => void;
  state: ResourceState<T>;
}

interface IngredientRequestSummary {
  items: MemberIngredientRequest[];
}

interface ActivityResource {
  state: ResourceState<unknown>;
}

type ResourceLoader<T> = (signal: AbortSignal) => Promise<T>;

const SUMMARY_PAGE_SIZE = 3;

function loadDrafts(signal: AbortSignal): Promise<MyRecipeLibraryPage> {
  return fetchMyRecipeLibrary({
    view: "drafts",
    page: 1,
    pageSize: SUMMARY_PAGE_SIZE,
    signal,
  });
}

function loadPublished(signal: AbortSignal): Promise<MyRecipeLibraryPage> {
  return fetchMyRecipeLibrary({
    view: "published",
    page: 1,
    pageSize: SUMMARY_PAGE_SIZE,
    signal,
  });
}

function loadWithdrawn(signal: AbortSignal): Promise<MyRecipeLibraryPage> {
  return fetchMyRecipeLibrary({
    view: "withdrawn",
    page: 1,
    pageSize: SUMMARY_PAGE_SIZE,
    signal,
  });
}

function loadSaved(signal: AbortSignal): Promise<SavedRecipeLibraryPage> {
  return fetchSavedRecipeLibrary({
    page: 1,
    pageSize: SUMMARY_PAGE_SIZE,
    signal,
  });
}

function loadFollowStats(signal: AbortSignal): Promise<MyFollowStats> {
  return fetchMyFollowStats(signal);
}

async function loadIngredientRequests(
  signal: AbortSignal,
): Promise<IngredientRequestSummary> {
  const reviewedRequests = await retryTransientRead(
    (readSignal) =>
      browseMyIngredientRequests({
        page: 1,
        pageSize: SUMMARY_PAGE_SIZE,
        reviewedOnly: true,
        signal: readSignal,
      }),
    { signal },
  );
  return {
    items: reviewedRequests.items,
  };
}

function resourceErrorMessage(reason: unknown, fallback: string): string {
  return reason instanceof RecipeLibraryApiError ||
    reason instanceof IngredientCatalogApiError ||
    reason instanceof MemberFollowApiError
    ? reason.message
    : fallback;
}

function reportAsHomeIssue(reason: unknown): boolean {
  if (
    reason instanceof RecipeLibraryApiError ||
    reason instanceof IngredientCatalogApiError ||
    reason instanceof MemberFollowApiError
  ) {
    return reason.status !== 401 && reason.status !== 403;
  }
  return true;
}

function useMemberHomeResource<T>(
  userId: string,
  loader: ResourceLoader<T>,
  fallbackError: string,
): MemberHomeResource<T> {
  const requestSequenceRef = useRef(0);
  const [reload, setReload] = useState(0);
  const [stored, setStored] = useState<StoredResourceState<T>>({
    state: { phase: "loading" },
    userId,
  });

  useEffect(() => {
    const sequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = sequence;
    const controller = new AbortController();

    void loader(controller.signal)
      .then((data) => {
        if (
          !controller.signal.aborted &&
          sequence === requestSequenceRef.current
        ) {
          setStored({ state: { data, phase: "ready" }, userId });
        }
      })
      .catch((reason: unknown) => {
        if (
          controller.signal.aborted ||
          sequence !== requestSequenceRef.current
        ) {
          return;
        }
        setStored({
          state: {
            message: resourceErrorMessage(reason, fallbackError),
            phase: "error",
            reportAsHomeIssue: reportAsHomeIssue(reason),
          },
          userId,
        });
      });

    return () => controller.abort();
  }, [fallbackError, loader, reload, userId]);

  const retry = useCallback(() => {
    requestSequenceRef.current += 1;
    setStored({ state: { phase: "loading" }, userId });
    setReload((current) => current + 1);
  }, [userId]);

  return {
    retry,
    state:
      stored.userId === userId ? stored.state : { phase: "loading" },
  };
}

function timestampValue(timestamp: string): number {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

function latestDraft(page: MyRecipeLibraryPage): RecipeDraftListItem | null {
  const drafts = page.items.flatMap((item) =>
    item.kind === "draft" ? [item.draft] : [],
  );
  return (
    drafts.sort((left, right) => {
      const byTime =
        timestampValue(right.updated_at) - timestampValue(left.updated_at);
      return byTime || left.id.localeCompare(right.id);
    })[0] ?? null
  );
}

function readyData<T>(state: ResourceState<T>): T | undefined {
  return state.phase === "ready" ? state.data : undefined;
}

function ResourceMetric<T>({
  href,
  label,
  linkLabel,
  state,
  total,
}: {
  href: string;
  label: string;
  linkLabel?: string;
  state: ResourceState<T>;
  total: (data: T) => number;
}) {
  return (
    <div className="member-home-summary__metric">
      <dt>{label}</dt>
      <dd>
        {state.phase === "loading" ? (
          <span aria-label={`${label} loading`}>
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

function ContinueDraftPanel({
  drafts,
}: {
  drafts: ResourceState<MyRecipeLibraryPage>;
}) {
  let content;
  if (drafts.phase === "loading") {
    content = (
      <SectionLoading
        className="member-home-summary__resource-state"
        count={1}
        label="Loading your latest draft…"
        layout="summary"
      />
    );
  } else if (drafts.phase === "error") {
    content = (
      <p className="member-home-summary__resource-state">
        Latest draft unavailable.
      </p>
    );
  } else {
    const draft = latestDraft(drafts.data);
    if (!draft) return null;

    const edited = relativeTimeLabel(draft.updated_at);
    content = (
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
            <span>
              {draft.source_version_id ? "Forked recipe" : "Original recipe"}
            </span>
            <small>
              Edited{" "}
              <time dateTime={draft.updated_at} title={edited?.absoluteLabel}>
                {edited?.relativeLabel ?? "recently"}
              </time>
            </small>
          </div>
        </div>
        <p className="member-home-summary__draft-counts">
          {draft.ingredient_count} ingredient
          {draft.ingredient_count === 1 ? "" : "s"}
          {" · "}
          {draft.instruction_count} step
          {draft.instruction_count === 1 ? "" : "s"}
        </p>
        <Link
          className="button button--primary"
          href={`/recipes/drafts/${draft.id}`}
        >
          Open draft
        </Link>
      </article>
    );
  }

  return (
    <section
      className="member-home-summary__panel member-home-summary__continue"
      aria-labelledby="member-home-continue-title"
    >
      <h2 id="member-home-continue-title">Continue where you left off</h2>
      {content}
    </section>
  );
}

function activityResourceNames(
  resources: ActivityResource[],
  phase: "error" | "loading",
): ActivityResource[] {
  return resources.filter((resource) => resource.state.phase === phase);
}

export function MemberHomeSummary({ userId }: MemberHomeSummaryProps) {
  const drafts = useMemberHomeResource(
    userId,
    loadDrafts,
    "Recipe Lab could not load your drafts. Please try again.",
  );
  const published = useMemberHomeResource(
    userId,
    loadPublished,
    "Recipe Lab could not load your published recipes. Please try again.",
  );
  const withdrawn = useMemberHomeResource(
    userId,
    loadWithdrawn,
    "Recipe Lab could not load your withdrawn recipes. Please try again.",
  );
  const saved = useMemberHomeResource(
    userId,
    loadSaved,
    "Recipe Lab could not load your saved recipes. Please try again.",
  );
  const ingredientRequests = useMemberHomeResource(
    userId,
    loadIngredientRequests,
    "Your ingredient requests could not be loaded. Please try again.",
  );
  const followStats = useMemberHomeResource(
    userId,
    loadFollowStats,
    "Your follower count could not be loaded. Please try again.",
  );

  const resources: ActivityResource[] = [
    { state: drafts.state },
    { state: published.state },
    { state: withdrawn.state },
    { state: saved.state },
    { state: ingredientRequests.state },
  ];
  const loadingResources = activityResourceNames(resources, "loading");
  const failedResources = activityResourceNames(resources, "error");
  const allResources = [
    drafts,
    published,
    withdrawn,
    saved,
    ingredientRequests,
    followStats,
  ];
  const hasReportableFailure = allResources.some(
    (resource) =>
      resource.state.phase === "error" && resource.state.reportAsHomeIssue,
  );
  useHomeLoadIssue({
    active: hasReportableFailure,
    id: "member-summary",
    retry: () => {
      for (const resource of allResources) {
        if (
          resource.state.phase === "error" &&
          resource.state.reportAsHomeIssue
        ) {
          resource.retry();
        }
      }
    },
  });
  const activities = buildMemberActivities({
    drafts: readyData(drafts.state),
    ingredientRequests: readyData(ingredientRequests.state),
    published: readyData(published.state),
    saved: readyData(saved.state),
    withdrawn: readyData(withdrawn.state),
  }).slice(0, SUMMARY_PAGE_SIZE);

  return (
    <div className="member-home-summary">
      <ContinueDraftPanel drafts={drafts.state} />

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
        ) : loadingResources.length === 0 && failedResources.length === 0 ? (
          <p>No recent account activity yet.</p>
        ) : null}
        {loadingResources.length > 0 ? (
          <SectionLoading
            className="member-home-summary__activity-state"
            count={3}
            label={
              activities.length > 0
                ? "Checking for other recent activity…"
                : "Loading recent activity…"
            }
            layout="rows"
            refreshing={activities.length > 0}
          />
        ) : null}
        {activities.length === 0 &&
        loadingResources.length === 0 &&
        failedResources.length > 0 ? (
          <p className="member-home-summary__activity-state">Unavailable.</p>
        ) : null}
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
            state={published.state}
            total={(page) => page.total}
          />
          <ResourceMetric
            href="/account/recipes?view=drafts"
            label="Active drafts"
            state={drafts.state}
            total={(page) => page.total}
          />
          <ResourceMetric
            href="/account/recipes?view=saved"
            label="Saved recipes"
            state={saved.state}
            total={(page) => page.total}
          />
          <ResourceMetric
            href="/account/followers"
            label="Followers"
            state={followStats.state}
            total={(stats) => stats.follower_count}
          />
        </dl>
      </section>
    </div>
  );
}
