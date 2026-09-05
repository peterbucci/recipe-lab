"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";

import { isAbortError } from "../../lib/abort-error";
import { AuthApiError } from "../../lib/auth-api";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import { formatMemberRecipeDate } from "../../lib/member-recipe-presentation";
import {
  createMyRecipeLibraryState,
  currentMyRecipeLibraryState,
  myRecipeLibraryReducer,
} from "../../lib/my-recipe-library-state";
import {
  discardRecipeDraft,
  RecipeDraftApiError,
  type RecipeDraftListItem,
} from "../../lib/recipe-draft-api";
import {
  fetchMyRecipeLibrary,
  type MyRecipeLibraryView,
  type RecipeVisibilityState,
} from "../../lib/recipe-library-api";
import { MemberRouteGate } from "./member-route-gate";
import {
  MyRecipesHubHeader,
  MyRecipesHubNavigation,
  myRecipesHref,
} from "./my-recipes-hub";
import { LoadingButton } from "./loading-ui";
import { MemberRecipeCard } from "./member-recipe-card";
import { GuardedLink } from "./navigation-blocker-provider";
import { RecipeArtwork } from "./recipe-artwork";
import { RecipeCardShell } from "./recipe-card-shell";
import { RecipeVisibilityControl } from "./recipe-visibility-control";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspacePagination } from "./workspace-pagination";
import { WorkspacePanelHeader } from "./workspace-panel-header";
import {
  WorkspaceErrorState,
  WorkspaceLoadingState,
} from "./workspace-state";

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

function viewLabel(view: MyRecipeLibraryView): string {
  return view.slice(0, 1).toUpperCase() + view.slice(1);
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
  return (
    <WorkspacePagination
      currentPage={currentPage}
      label={`${viewLabel(view)} recipe pages`}
      totalPages={totalPages}
      renderControl={({ disabled, label, page }) =>
        disabled ? (
          <span className="button button--disabled" aria-disabled="true">
            {label}
          </span>
        ) : (
          <GuardedLink
            className="button button--secondary"
            href={myRecipesHref(view, page)}
          >
            {label}
          </GuardedLink>
        )
      }
    />
  );
}

function MyRecipeLibraryInner({ pageNumber, view }: MyRecipeLibraryProps) {
  const router = useRouter();
  const key = `${view}:${pageNumber}`;
  const requestSequence = useRef(0);
  const discardAttempts = useRef(new Map<string, string>());
  const discardInFlight = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const discardReturnFocusRef = useRef<HTMLElement | null>(null);
  const [state, dispatch] = useReducer(
    myRecipeLibraryReducer,
    key,
    createMyRecipeLibraryState,
  );
  const currentLocation = useRef({ key, pageNumber, view });
  const {
    confirmingId,
    discardingId,
    error,
    focusStatus,
    loading,
    operationError,
    page,
    status,
  } = currentMyRecipeLibraryState(state, key);
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
      dispatch({ type: "load_started", key: requestKey });
      try {
        const nextPage = await fetchMyRecipeLibrary({
          view: requestedView,
          page: requestedPage,
          pageSize: 12,
          signal,
        });
        if (sequence === requestSequence.current && !signal?.aborted) {
          dispatch({
            type: "load_succeeded",
            key: requestKey,
            page: nextPage,
          });
        }
      } catch (reason) {
        if (isAbortError(reason)) {
          if (sequence === requestSequence.current && !signal?.aborted) {
            dispatch({ type: "load_cancelled", key: requestKey });
          }
          return;
        }
        if (sequence === requestSequence.current) {
          dispatch({
            type: "load_failed",
            key: requestKey,
            message: `Recipe Lab could not load your ${VIEW_COPY[
              requestedView
            ].heading.toLowerCase()}. Please try again.`,
          });
        }
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      dispatch({ type: "location_changed", key });
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
      dispatch({
        type: "status_set",
        focus: false,
        key: location.key,
        message,
      });
      await load(location.view, location.pageNumber);
      return;
    }

    const targetPage =
      page?.items.length === 1 && pageNumber > 1 ? pageNumber - 1 : pageNumber;
    const targetKey = `${view}:${targetPage}`;
    dispatch({
      type: "item_removed",
      itemKey,
      message,
      originKey,
      targetKey,
    });
    discardReturnFocusRef.current = null;
    if (targetPage !== pageNumber) {
      router.replace(myRecipesHref(view, targetPage));
      return;
    }
    await load(view, pageNumber);
  }

  async function discard(draft: RecipeDraftListItem) {
    if (discardInFlight.current || discardingId) return;
    discardInFlight.current = true;
    dispatch({ type: "discard_started", key, draftId: draft.id });
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
        dispatch({
          type: "discard_failed",
          key: originKey,
          message:
            "This draft changed in another tab. It was not discarded. Refresh the list and review it first.",
        });
      } else if (
        (reason instanceof RecipeDraftApiError ||
          reason instanceof AuthApiError) &&
        reason.status === 401
      ) {
        dispatch({
          type: "discard_failed",
          key: originKey,
          message:
            "Your session expired. This draft was not discarded. Sign in again to continue.",
        });
      } else {
        dispatch({
          type: "discard_failed",
          key: originKey,
          message:
            "Recipe Lab could not discard this draft. It is still private and intact.",
        });
      }
    } finally {
      discardInFlight.current = false;
      dispatch({ type: "discard_finished", draftId: draft.id });
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
            <WorkspaceErrorState
              className="form-alert"
              message={error}
              action={<button
                className="button button--secondary"
                type="button"
                onClick={() => void load(view, pageNumber)}
              >
                Refresh {copy.heading.toLowerCase()}
              </button>}
            />
          ) : null}
          {loading ? (
            <WorkspaceLoadingState
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
            <WorkspaceEmptyState
              action={<GuardedLink
                className="button button--secondary"
                href={myRecipesHref(view)}
              >
                Return to the first page
              </GuardedLink>}
              description={`This view currently has ${page.total_pages} pages.`}
              eyebrow="Page unavailable"
              headingId={`stale-my-recipes-${view}`}
              title={`That page is beyond your ${copy.resultName}s.`}
            />
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
                      <RecipeCardShell
                        aria-labelledby={`my-draft-${draft.id}`}
                        artwork={
                          <div className="member-recipe-card__artwork">
                            <RecipeArtwork
                              className="member-recipe-card__artwork-graphic"
                              recipeKey={draft.source_version_id ?? draft.id}
                            />
                          </div>
                        }
                        bodyClassName="member-recipe-card__body"
                        className="member-recipe-card member-recipe-card--draft"
                        itemClassName="member-recipe-card__item"
                        key={`draft-${draft.id}`}
                      >
                        <div className="member-recipe-card__topline">
                          <span className="member-recipe-card__status member-recipe-card__status--draft">
                            {draft.source_version_id ? "Version" : "Original"}
                          </span>
                        </div>
                        <h3 id={`my-draft-${draft.id}`}>{title}</h3>
                        {draft.source_version_id && item.source_recipe_title ? (
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
                              {formatMemberRecipeDate(draft.updated_at)}
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
                                discardReturnFocusRef.current = event.currentTarget;
                              dispatch({
                                type: "confirmation_toggled",
                                key,
                                draftId: draft.id,
                              });
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
                              This permanently deletes this private draft. It
                              cannot be restored.
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
                                  dispatch({ type: "confirmation_closed" });
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
                      </RecipeCardShell>
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
