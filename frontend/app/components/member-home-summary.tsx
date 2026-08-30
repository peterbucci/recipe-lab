"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  browseMyIngredientRequests,
  IngredientCatalogApiError,
  type MemberIngredientRequestPage,
} from "../../lib/ingredient-catalog-api";
import type { RecipeDraftListItem } from "../../lib/recipe-draft-api";
import {
  fetchMyRecipeLibrary,
  fetchSavedRecipeLibrary,
  type MyRecipeLibraryPage,
  RecipeLibraryApiError,
  type SavedRecipeLibraryPage,
} from "../../lib/recipe-library-api";

interface MemberHomeSummaryProps {
  userId: string;
}

type ResourceState<T> =
  | { phase: "loading" }
  | { data: T; phase: "ready" }
  | { message: string; phase: "error" };

interface StoredResourceState<T> {
  state: ResourceState<T>;
  userId: string;
}

interface MemberHomeResource<T> {
  retry: () => void;
  state: ResourceState<T>;
}

interface MemberHomeActivity {
  detail?: string;
  href: string;
  id: string;
  label: string;
  timestamp: string;
  title: string;
}

interface ActivityResource {
  name: string;
  retry: () => void;
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

function loadIngredientRequests(
  signal: AbortSignal,
): Promise<MemberIngredientRequestPage> {
  return browseMyIngredientRequests({
    page: 1,
    pageSize: SUMMARY_PAGE_SIZE,
    signal,
  });
}

function resourceErrorMessage(reason: unknown, fallback: string): string {
  return reason instanceof RecipeLibraryApiError ||
    reason instanceof IngredientCatalogApiError
    ? reason.message
    : fallback;
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

function requestActivityLabel(status: string): string {
  if (status === "approved") return "Ingredient request approved";
  if (status === "duplicate") return "Ingredient request matched";
  if (status === "rejected") return "Ingredient request rejected";
  return "Ingredient request reviewed";
}

function buildRecentActivities({
  drafts,
  ingredientRequests,
  published,
  saved,
  withdrawn,
}: {
  drafts?: MyRecipeLibraryPage;
  ingredientRequests?: MemberIngredientRequestPage;
  published?: MyRecipeLibraryPage;
  saved?: SavedRecipeLibraryPage;
  withdrawn?: MyRecipeLibraryPage;
}): MemberHomeActivity[] {
  const activities: MemberHomeActivity[] = [];

  for (const item of drafts?.items ?? []) {
    if (item.kind !== "draft") continue;
    activities.push({
      href: `/account/recipe-drafts/${item.draft.id}`,
      id: `draft:${item.draft.id}`,
      label: "Updated draft",
      timestamp: item.draft.updated_at,
      title: item.draft.title.trim() || "Untitled recipe",
    });
  }

  for (const item of published?.items ?? []) {
    if (item.kind !== "published") continue;
    activities.push({
      detail:
        item.visibility_state === "moderation_hidden"
          ? "Currently hidden by moderation"
          : undefined,
      href: "/account/recipes?view=published",
      id: `published:${item.recipe.id}`,
      label: "Published recipe version",
      timestamp: item.recipe.published_at,
      title: item.recipe.title,
    });
  }

  for (const item of withdrawn?.items ?? []) {
    if (item.kind !== "published") continue;
    activities.push({
      detail: "Currently withdrawn",
      href: "/account/recipes?view=withdrawn",
      id: `withdrawn:${item.recipe.id}`,
      label: "Published recipe version",
      timestamp: item.recipe.published_at,
      title: item.recipe.title,
    });
  }

  for (const item of saved?.items ?? []) {
    activities.push({
      href: "/account/saved-recipes",
      id: `saved:${item.recipe.id}`,
      label: "Saved recipe",
      timestamp: item.saved_at,
      title: item.recipe.title,
    });
  }

  for (const item of ingredientRequests?.items ?? []) {
    if (item.reviewed_at === null) continue;
    activities.push({
      detail: `Status: ${item.status}`,
      href: "/account/ingredient-requests",
      id: `ingredient-request:${item.id}`,
      label: requestActivityLabel(item.status),
      timestamp: item.reviewed_at,
      title: item.proposed_name,
    });
  }

  return activities
    .filter((activity) => Number.isFinite(Date.parse(activity.timestamp)))
    .sort((left, right) => {
      const byTime =
        timestampValue(right.timestamp) - timestampValue(left.timestamp);
      return byTime || left.id.localeCompare(right.id);
    })
    .slice(0, 3);
}

function formatActivity(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(timestamp));
}

function readyData<T>(state: ResourceState<T>): T | undefined {
  return state.phase === "ready" ? state.data : undefined;
}

function ResourceMetric<T>({
  label,
  retry,
  retryLabel,
  state,
  total,
}: {
  label: string;
  retry: () => void;
  retryLabel: string;
  state: ResourceState<T>;
  total: (data: T) => number;
}) {
  return (
    <div className="member-home-summary__metric">
      <dt>{label}</dt>
      <dd>
        {state.phase === "loading" ? (
          <span role="status">Loading…</span>
        ) : state.phase === "error" ? (
          <span className="member-home-summary__metric-error" role="alert">
            <span>Unavailable. {state.message}</span>
            <button
              className="button button--quiet"
              type="button"
              onClick={retry}
            >
              {retryLabel}
            </button>
          </span>
        ) : (
          total(state.data)
        )}
      </dd>
    </div>
  );
}

function PublishedVersionMetric({
  published,
  retryPublished,
  retryWithdrawn,
  withdrawn,
}: {
  published: ResourceState<MyRecipeLibraryPage>;
  retryPublished: () => void;
  retryWithdrawn: () => void;
  withdrawn: ResourceState<MyRecipeLibraryPage>;
}) {
  const loading =
    published.phase === "loading" || withdrawn.phase === "loading";
  const errors = [
    published.phase === "error"
      ? {
          label: "Retry published recipes",
          message: published.message,
          retry: retryPublished,
        }
      : null,
    withdrawn.phase === "error"
      ? {
          label: "Retry withdrawn recipes",
          message: withdrawn.message,
          retry: retryWithdrawn,
        }
      : null,
  ].filter(
    (
      item,
    ): item is { label: string; message: string; retry: () => void } =>
      item !== null,
  );

  return (
    <div className="member-home-summary__metric">
      <dt>Versions published</dt>
      <dd>
        {errors.length > 0 ? (
          <span className="member-home-summary__metric-error" role="alert">
            <span>Unavailable</span>
            {errors.map((error) => (
              <span key={error.label}>
                <span>{error.message}</span>
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={error.retry}
                >
                  {error.label}
                </button>
              </span>
            ))}
            {loading ? <span>Other version totals are still loading.</span> : null}
          </span>
        ) : loading ? (
          <span role="status">Loading…</span>
        ) : published.phase === "ready" && withdrawn.phase === "ready" ? (
          published.data.total + withdrawn.data.total
        ) : null}
      </dd>
    </div>
  );
}

function ContinueDraftPanel({
  drafts,
  retry,
}: {
  drafts: ResourceState<MyRecipeLibraryPage>;
  retry: () => void;
}) {
  let content;
  if (drafts.phase === "loading") {
    content = (
      <p className="member-home-summary__resource-state" role="status">
        Loading your latest draft…
      </p>
    );
  } else if (drafts.phase === "error") {
    content = (
      <div className="member-home-summary__resource-state" role="alert">
        <p>{drafts.message}</p>
        <button
          className="button button--secondary"
          type="button"
          onClick={retry}
        >
          Retry drafts
        </button>
      </div>
    );
  } else {
    const draft = latestDraft(drafts.data);
    content = draft ? (
      <article
        className="member-home-summary__draft"
        aria-labelledby={`member-home-draft-${draft.id}`}
      >
        <p className="eyebrow">
          {draft.source_version_id ? "Version draft" : "Original draft"}
        </p>
        <h3 id={`member-home-draft-${draft.id}`}>
          {draft.title.trim() || "Untitled recipe"}
        </h3>
        <p>
          {draft.ingredient_count} ingredient
          {draft.ingredient_count === 1 ? "" : "s"}
          {" · "}
          {draft.instruction_count} step
          {draft.instruction_count === 1 ? "" : "s"}
        </p>
        <p>
          Updated{" "}
          <time dateTime={draft.updated_at}>
            {formatActivity(draft.updated_at)}
          </time>
        </p>
        <Link
          className="button button--primary"
          href={`/account/recipe-drafts/${draft.id}`}
        >
          Continue draft
        </Link>
      </article>
    ) : (
      <div className="member-home-summary__resource-state">
        <p>You have no active drafts right now.</p>
        <Link className="button button--primary" href="/recipes/new">
          Start a recipe
        </Link>
      </div>
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
): string[] {
  return resources.flatMap((resource) =>
    resource.state.phase === phase ? [resource.name] : [],
  );
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

  const resources: ActivityResource[] = [
    { name: "drafts", retry: drafts.retry, state: drafts.state },
    {
      name: "published recipes",
      retry: published.retry,
      state: published.state,
    },
    {
      name: "withdrawn recipes",
      retry: withdrawn.retry,
      state: withdrawn.state,
    },
    { name: "saved recipes", retry: saved.retry, state: saved.state },
    {
      name: "ingredient requests",
      retry: ingredientRequests.retry,
      state: ingredientRequests.state,
    },
  ];
  const loadingResources = activityResourceNames(resources, "loading");
  const failedResources = resources.filter(
    (resource) => resource.state.phase === "error",
  );
  const activities = buildRecentActivities({
    drafts: readyData(drafts.state),
    ingredientRequests: readyData(ingredientRequests.state),
    published: readyData(published.state),
    saved: readyData(saved.state),
    withdrawn: readyData(withdrawn.state),
  });

  return (
    <div className="member-home-summary">
      <ContinueDraftPanel drafts={drafts.state} retry={drafts.retry} />

      <section
        className="member-home-summary__panel member-home-summary__stats"
        aria-labelledby="member-home-stats-title"
      >
        <h2 id="member-home-stats-title">Your stats</h2>
        <dl className="member-home-summary__metrics">
          <PublishedVersionMetric
            published={published.state}
            retryPublished={published.retry}
            retryWithdrawn={withdrawn.retry}
            withdrawn={withdrawn.state}
          />
          <ResourceMetric
            label="Active drafts"
            retry={drafts.retry}
            retryLabel="Retry drafts"
            state={drafts.state}
            total={(page) => page.total}
          />
          <ResourceMetric
            label="Saved recipes"
            retry={saved.retry}
            retryLabel="Retry saved recipes"
            state={saved.state}
            total={(page) => page.total}
          />
          <ResourceMetric
            label="Ingredient requests"
            retry={ingredientRequests.retry}
            retryLabel="Retry ingredient requests"
            state={ingredientRequests.state}
            total={(page) => page.total}
          />
        </dl>
      </section>

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
            {activities.map((activity) => (
              <li key={activity.id}>
                <Link href={activity.href}>
                  <span>{activity.label}</span>
                  <strong>{activity.title}</strong>
                </Link>
                {activity.detail ? <span>{activity.detail}</span> : null}
                <time dateTime={activity.timestamp}>
                  {formatActivity(activity.timestamp)}
                </time>
              </li>
            ))}
          </ol>
        ) : loadingResources.length === 0 && failedResources.length === 0 ? (
          <p>No recent account activity yet.</p>
        ) : null}
        {loadingResources.length > 0 ? (
          <p className="member-home-summary__activity-state" role="status">
            {activities.length > 0
              ? "Checking for other recent activity…"
              : "Loading recent activity…"}
          </p>
        ) : null}
        {failedResources.length > 0 ? (
          <div className="member-home-summary__activity-state" role="alert">
            <p>
              Some recent activity is unavailable from {failedResources
                .map((resource) => resource.name)
                .join(", ")}.
            </p>
            {failedResources.map((resource) => (
              <button
                className="button button--quiet"
                key={resource.name}
                type="button"
                onClick={resource.retry}
              >
                Retry {resource.name} for activity
              </button>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
