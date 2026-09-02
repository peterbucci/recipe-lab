"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { AuthApiError } from "../../lib/auth-api";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import {
  discardRecipeDraft,
  RecipeDraftApiError,
  type RecipeDraftListItem,
} from "../../lib/recipe-draft-api";
import {
  fetchMyRecipeLibrary,
  type MyRecipeLibraryItem,
  type MyRecipeLibraryPage,
  type MyRecipeLibraryView,
  type RecipeVisibilityState,
} from "../../lib/recipe-library-api";
import { MemberRouteGate } from "./member-route-gate";
import {
  MyRecipesHubHeader,
  MyRecipesHubNavigation,
  myRecipesHref,
} from "./my-recipes-hub";
import { LoadingButton, SectionLoading } from "./loading-ui";
import { MemberRecipeCard } from "./member-recipe-card";
import { GuardedLink } from "./navigation-blocker-provider";
import { RecipeArtwork } from "./recipe-artwork";
import { RecipeVisibilityControl } from "./recipe-visibility-control";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspacePanelHeader } from "./workspace-panel-header";

interface MyRecipeLibraryProps {
  pageNumber: number;
  view: MyRecipeLibraryView;
}

interface ViewCopy {
  emptyBody: string;
  emptyTitle: string;
  heading: string;
  listLabel: string;
  privacy: string;
  resultName: string;
}

const VIEW_COPY: Record<MyRecipeLibraryView, ViewCopy> = {
  drafts: {
    emptyBody:
      "Start an original recipe, or make your own version of a public recipe.",
    emptyTitle: "You have no private drafts yet.",
    heading: "Private drafts",
    listLabel: "Private recipe drafts",
    privacy:
      "Only you can see these drafts. They never appear in public recipes or search.",
    resultName: "draft",
  },
  published: {
    emptyBody: "Publish a private draft when it is ready to share.",
    emptyTitle: "You have no published recipes yet.",
    heading: "Published recipes",
    listLabel: "Published recipes",
    privacy:
      "These recipes have been published. A recipe hidden by moderation remains visible to you here with its current status.",
    resultName: "published recipe",
  },
  withdrawn: {
    emptyBody:
      "Recipes you withdraw from public view will stay available to you here.",
    emptyTitle: "You have no withdrawn recipes.",
    heading: "Withdrawn recipes",
    listLabel: "Withdrawn recipes",
    privacy:
      "Withdrawn recipes are no longer public, but you can review or restore them here.",
    resultName: "withdrawn recipe",
  },
};

function formatActivity(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(timestamp),
  );
}

function viewLabel(view: MyRecipeLibraryView): string {
  return view.slice(0, 1).toUpperCase() + view.slice(1);
}

function libraryItemKey(item: MyRecipeLibraryItem): string {
  return item.kind === "draft"
    ? `draft:${item.draft.id}`
    : `published:${item.recipe.id}`;
}

function MyRecipePagination({
  currentPage,
  totalPages,
  view,
}: {
  currentPage: number;
  totalPages: number;
  view: MyRecipeLibraryView;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav className="pagination" aria-label={`${viewLabel(view)} recipe pages`}>
      {currentPage > 1 ? (
        <GuardedLink
          className="button button--secondary"
          href={myRecipesHref(view, currentPage - 1)}
        >
          ← Previous
        </GuardedLink>
      ) : (
        <span className="button button--disabled" aria-disabled="true">
          ← Previous
        </span>
      )}
      <span className="pagination__status" aria-current="page">
        Page {currentPage} of {totalPages}
      </span>
      {currentPage < totalPages ? (
        <GuardedLink
          className="button button--secondary"
          href={myRecipesHref(view, currentPage + 1)}
        >
          Next →
        </GuardedLink>
      ) : (
        <span className="button button--disabled" aria-disabled="true">
          Next →
        </span>
      )}
    </nav>
  );
}

function MyRecipeLibraryInner({ pageNumber, view }: MyRecipeLibraryProps) {
  const router = useRouter();
  const requestSequence = useRef(0);
  const discardAttempts = useRef(new Map<string, string>());
  const discardInFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const [result, setResult] = useState<{
    key: string;
    page: MyRecipeLibraryPage;
  } | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(
    `${view}:${pageNumber}`,
  );
  const [loadError, setLoadError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [operationErrorState, setOperationError] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [statusState, setStatus] = useState<{
    focus: boolean;
    key: string;
    message: string;
  } | null>(null);
  const [confirmation, setConfirmation] = useState<{
    key: string;
    id: string;
  } | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const key = `${view}:${pageNumber}`;
  const currentLocation = useRef({ key, pageNumber, view });
  const page = result?.key === key ? result.page : null;
  const error = loadError?.key === key ? loadError.message : "";
  const operationError =
    operationErrorState?.key === key ? operationErrorState.message : "";
  const status = statusState?.key === key ? statusState.message : "";
  const focusStatus = statusState?.key === key && statusState.focus;
  const confirmingId = confirmation?.key === key ? confirmation.id : null;
  const loading = pendingKey === key || (!page && !error);
  const copy = VIEW_COPY[view];
  const beyondLastPage = Boolean(
    page && page.total > 0 && page.items.length === 0,
  );

  useLayoutEffect(() => {
    currentLocation.current = { key, pageNumber, view };
  }, [key, pageNumber, view]);

  const load = useCallback(
    async (
      requestedView: MyRecipeLibraryView,
      requestedPage: number,
      signal?: AbortSignal,
    ) => {
      if (signal?.aborted) return;
      const requestKey = `${requestedView}:${requestedPage}`;
      const sequence = ++requestSequence.current;
      setPendingKey(requestKey);
      setLoadError(null);
      try {
        const nextPage = await fetchMyRecipeLibrary({
          view: requestedView,
          page: requestedPage,
          pageSize: 12,
          signal,
        });
        if (sequence === requestSequence.current && !signal?.aborted) {
          setResult({ key: requestKey, page: nextPage });
        }
      } catch (reason) {
        if (reason instanceof DOMException && reason.name === "AbortError")
          return;
        if (sequence === requestSequence.current) {
          setLoadError({
            key: requestKey,
            message: `Recipe Lab could not load your ${VIEW_COPY[
              requestedView
            ].heading.toLowerCase()}. Please try again.`,
          });
        }
      } finally {
        if (sequence === requestSequence.current && !signal?.aborted)
          setPendingKey(null);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setOperationError((current) => (current?.key === key ? current : null));
      setStatus((current) => (current?.key === key ? current : null));
      setConfirmation((current) => (current?.key === key ? current : null));
      discardReturnFocusRef.current = null;
      return load(view, pageNumber, controller.signal);
    });
    return () => controller.abort();
  }, [key, load, pageNumber, view]);

  useEffect(() => {
    if (status && focusStatus) statusRef.current?.focus();
  }, [focusStatus, status]);

  async function refreshAfterRemoval(
    itemKey: string,
    message: string,
    originKey: string,
  ) {
    const location = currentLocation.current;
    if (location.key !== originKey) {
      setStatus({ focus: false, key: location.key, message });
      await load(location.view, location.pageNumber);
      return;
    }

    const targetPage =
      page?.items.length === 1 && pageNumber > 1 ? pageNumber - 1 : pageNumber;
    const targetKey = `${view}:${targetPage}`;
    setResult((current) => {
      if (current?.key !== originKey) return current;
      const items = current.page.items.filter(
        (item) => libraryItemKey(item) !== itemKey,
      );
      const total = Math.max(
        0,
        current.page.total - (items.length < current.page.items.length ? 1 : 0),
      );
      return {
        key: current.key,
        page: {
          ...current.page,
          items,
          total,
          total_pages: Math.ceil(total / current.page.page_size),
        },
      };
    });
    setConfirmation(null);
    discardReturnFocusRef.current = null;
    setStatus({ focus: true, key: targetKey, message });
    if (targetPage !== pageNumber) {
      router.replace(myRecipesHref(view, targetPage));
      return;
    }
    await load(view, pageNumber);
  }

  async function discard(draft: RecipeDraftListItem) {
    if (discardInFlight.current || discardingId) return;
    discardInFlight.current = true;
    setDiscardingId(draft.id);
    setOperationError(null);
    setStatus(null);
    const idempotencyKey =
      discardAttempts.current.get(draft.id) ?? createIdempotencyKey();
    discardAttempts.current.set(draft.id, idempotencyKey);
    const title = draft.title.trim() || "Untitled recipe";
    const originKey = key;
    try {
      await discardRecipeDraft(draft.id, draft.revision, idempotencyKey);
      discardAttempts.current.delete(draft.id);
      await refreshAfterRemoval(
        `draft:${draft.id}`,
        `${title} was permanently discarded.`,
        originKey,
      );
    } catch (reason) {
      if (currentLocation.current.key !== originKey) return;
      if (
        reason instanceof RecipeDraftApiError &&
        reason.code === "recipe_draft_revision_conflict"
      ) {
        setOperationError({
          key: originKey,
          message:
            "This draft changed in another tab. It was not discarded. Refresh the list and review it first.",
        });
      } else if (
        (reason instanceof RecipeDraftApiError ||
          reason instanceof AuthApiError) &&
        reason.status === 401
      ) {
        setOperationError({
          key: originKey,
          message:
            "Your session expired. This draft was not discarded. Sign in again to continue.",
        });
      } else {
        setOperationError({
          key: originKey,
          message:
            "Recipe Lab could not discard this draft. It is still private and intact.",
        });
      }
    } finally {
      discardInFlight.current = false;
      setDiscardingId(null);
    }
  }

  async function handleVisibilityChanged(
    recipeVersionId: string,
    title: string,
    visibilityState: RecipeVisibilityState,
  ) {
    await refreshAfterRemoval(
      `published:${recipeVersionId}`,
      visibilityState === "author_withdrawn"
        ? `${title} moved to Withdrawn.`
        : `${title} moved to Published.`,
      key,
    );
  }

  return (
    <main
      id="main-content"
      className="page-shell account-workspace-page account-recipes-page member-library"
    >
      <MyRecipesHubHeader />

      <div className="member-library__frame">
        <MyRecipesHubNavigation
          activeCount={page && !beyondLastPage ? page.total : null}
          activeView={view}
        />
        <WorkspacePanelHeader
          description={copy.privacy}
          headingId="my-recipes-list-heading"
          meta={
            page && !beyondLastPage ? (
              <span aria-live="polite">
                {page.total} {copy.resultName}
                {page.total === 1 ? "" : "s"}
              </span>
            ) : null
          }
          title={copy.heading}
        />

        <div className="member-library__content">
          {status ? (
            <p
              className="form-status"
              role="status"
              tabIndex={-1}
              ref={statusRef}
            >
              {status}
            </p>
          ) : null}
          {operationError ? (
            <div className="form-alert" role="alert">
              <p>{operationError}</p>
            </div>
          ) : null}
          {error ? (
            <div className="form-alert" role="alert">
              <p>{error}</p>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => void load(view, pageNumber)}
              >
                Refresh {copy.heading.toLowerCase()}
              </button>
            </div>
          ) : null}
          {loading ? (
            <SectionLoading
              count={4}
              label={`${page ? "Updating" : "Loading"} ${copy.heading.toLowerCase()}…`}
              layout="cards"
              refreshing={Boolean(page)}
            />
          ) : null}

          {!loading && page?.total === 0 ? (
            <WorkspaceEmptyState
              action={
                view === "drafts" ? (
                <GuardedLink
                  className="button button--primary"
                  href="/recipes/new"
                >
                  Start a new recipe
                </GuardedLink>
                ) : null
              }
              description={copy.emptyBody}
              headingId={`empty-my-recipes-${view}`}
              title={copy.emptyTitle}
            />
          ) : null}

          {!loading && beyondLastPage && page ? (
            <section
              className="empty-state"
              aria-labelledby={`stale-my-recipes-${view}`}
            >
              <h2 id={`stale-my-recipes-${view}`}>
                That page is beyond your {copy.resultName}s.
              </h2>
              <p>This view currently has {page.total_pages} pages.</p>
              <GuardedLink
                className="button button--secondary"
                href={myRecipesHref(view)}
              >
                Return to the first page
              </GuardedLink>
            </section>
          ) : null}

          {page && !beyondLastPage && page.items.length > 0 ? (
            <>
              <section
                className="member-library__collection"
                aria-labelledby="my-recipes-list-heading"
              >
                <ul
                  className="recipe-grid member-library__grid"
                  aria-label={copy.listLabel}
                  aria-busy={loading}
                >
                  {page.items.map((item) => {
                    if (item.kind === "published") {
                      return (
                        <MemberRecipeCard
                          key={`published-${item.recipe.id}`}
                          actions={
                            <RecipeVisibilityControl
                              compact
                              onChanged={(visibilityState) =>
                                handleVisibilityChanged(
                                  item.recipe.id,
                                  item.recipe.title,
                                  visibilityState,
                                )
                              }
                              recipeTitle={item.recipe.title}
                              recipeVersionId={item.recipe.id}
                              state={item.visibility_state}
                            />
                          }
                          recipe={item.recipe}
                          state={
                            item.visibility_state === "author_withdrawn"
                              ? "withdrawn"
                              : item.visibility_state
                          }
                        />
                      );
                    }

                    const draft = item.draft;
                    const title = draft.title.trim() || "Untitled recipe";
                    const confirming = confirmingId === draft.id;
                    return (
                      <li
                        className="member-recipe-card__item"
                        key={`draft-${draft.id}`}
                      >
                        <article
                          className="member-recipe-card member-recipe-card--draft"
                          aria-labelledby={`my-draft-${draft.id}`}
                        >
                          <div className="member-recipe-card__artwork">
                            <RecipeArtwork
                              className="member-recipe-card__artwork-graphic"
                              recipeKey={draft.source_version_id ?? draft.id}
                            />
                          </div>
                          <div className="member-recipe-card__body">
                            <div className="member-recipe-card__topline">
                              <span className="member-recipe-card__status member-recipe-card__status--draft">
                                {draft.source_version_id
                                  ? "Version"
                                  : "Original"}
                              </span>
                            </div>
                            <h3 id={`my-draft-${draft.id}`}>{title}</h3>
                            {draft.source_version_id &&
                            item.source_recipe_title ? (
                              <p className="member-recipe-card__context">
                                Based on{" "}
                                <GuardedLink
                                  href={`/recipes/${draft.source_version_id}`}
                                >
                                  {item.source_recipe_title}
                                </GuardedLink>
                              </p>
                            ) : null}
                            {item.description ? (
                              <p className="member-recipe-card__description">
                                {item.description}
                              </p>
                            ) : null}
                            <div className="member-recipe-card__metadata">
                              <span>
                                Edited{" "}
                                <time dateTime={draft.updated_at}>
                                  {formatActivity(draft.updated_at)}
                                </time>
                              </span>
                            </div>
                            <div className="member-recipe-card__actions">
                              <GuardedLink
                                className="button button--primary"
                                href={`/recipes/drafts/${draft.id}`}
                              >
                                Continue editing
                              </GuardedLink>
                              <button
                                className="button button--quiet"
                                type="button"
                                aria-expanded={confirming}
                                aria-controls={`discard-${draft.id}`}
                                onClick={(event) => {
                                  if (!confirming)
                                    discardReturnFocusRef.current =
                                      event.currentTarget;
                                  setConfirmation(
                                    confirming ? null : { key, id: draft.id },
                                  );
                                }}
                              >
                                Discard
                              </button>
                            </div>
                            {confirming ? (
                              <div
                                id={`discard-${draft.id}`}
                                className="draft-discard"
                                role="group"
                                aria-label={`Discard ${title}`}
                              >
                                <p>
                                  <strong>Discard {title}?</strong>
                                </p>
                                <p>
                                  This permanently deletes this private draft.
                                  It cannot be restored.
                                </p>
                                <div className="button-row">
                                  <LoadingButton
                                    className="button button--danger"
                                    type="button"
                                    pending={discardingId === draft.id}
                                    pendingLabel="Discarding…"
                                    onClick={() => void discard(draft)}
                                  >
                                    Discard permanently
                                  </LoadingButton>
                                  <button
                                    className="button button--secondary"
                                    type="button"
                                    disabled={discardingId === draft.id}
                                    onClick={() => {
                                      setConfirmation(null);
                                      window.requestAnimationFrame(() =>
                                        discardReturnFocusRef.current?.focus(),
                                      );
                                    }}
                                  >
                                    Keep draft
                                  </button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ul>
              </section>
              <MyRecipePagination
                currentPage={page.page}
                totalPages={page.total_pages}
                view={view}
              />
            </>
          ) : null}
        </div>
      </div>

    </main>
  );
}

export function MyRecipeLibrary(props: MyRecipeLibraryProps) {
  return (
    <MemberRouteGate
      eyebrow="Your recipe workspace"
      returnTo={myRecipesHref(props.view, props.pageNumber)}
      title="My recipes"
    >
      <MyRecipeLibraryInner {...props} />
    </MemberRouteGate>
  );
}
