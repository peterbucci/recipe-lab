"use client";

import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";

import { isAbortError } from "../../../shared/api/abort-error";
import { createIdempotencyKey } from "../../../shared/api/idempotency-key";
import { setRecipeSaved } from "../detail/interaction-api";
import { fetchSavedRecipeLibrary } from "./recipe-library-api";
import { RecipeLibraryApiError } from "../shared/recipe-library-error";
import {
  MyRecipesHubHeader,
  MyRecipesHubNavigation,
} from "./my-recipes-hub";
import { myRecipesHref } from "./my-recipes-route";
import {
  createSavedRecipeLibraryState,
  currentSavedRecipeLibraryState,
  savedRecipeLibraryReducer,
  type SavedRecipeRemovalAttempt,
} from "./saved-recipe-library-state";
import { MemberRecipeCard } from "./member-recipe-card";
import { GuardedLink } from "../../../shared/navigation/navigation-blocker-provider";
import { LoadingButton, SectionLoading } from "../../../shared/ui/loading-ui";
import { WorkspaceEmptyState } from "../../../shared/ui/workspace-empty-state";
import { WorkspacePanelHeader } from "../../../shared/ui/workspace-panel-header";
import { WorkspacePagination } from "../../../shared/ui/workspace-pagination";

interface SavedRecipeLibraryProps {
  pageNumber: number;
}

interface SavedRecipeIdempotencyAttempt {
  attemptId: number;
  idempotencyKey: string;
}

function locationKey(pageNumber: number): string {
  return `saved:${pageNumber}`;
}

function SavedRecipePagination({
  currentPage,
  loading,
  totalPages,
}: {
  currentPage: number;
  loading: boolean;
  totalPages: number;
}) {
  return (
    <WorkspacePagination
      currentPage={currentPage}
      label="Saved recipe pages"
      loading={loading}
      totalPages={totalPages}
      renderControl={({ disabled, label, page }) =>
        disabled ? (
          <span className="button button--disabled" aria-disabled="true">
            {label}
          </span>
        ) : (
          <GuardedLink
            className="button button--secondary"
            href={myRecipesHref("saved", page)}
          >
            {label}
          </GuardedLink>
        )
      }
    />
  );
}

export function SavedRecipeLibrary({ pageNumber }: SavedRecipeLibraryProps) {
  const router = useRouter();
  const key = locationKey(pageNumber);
  const requestSequence = useRef(0);
  const removalSequence = useRef(0);
  const removeAttempts = useRef(
    new Map<string, SavedRecipeIdempotencyAttempt>(),
  );
  const activeRemovalRef = useRef<SavedRecipeRemovalAttempt | null>(null);
  const currentLocationRef = useRef({ key, pageNumber, snapshotId: null as number | null });
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [state, dispatch] = useReducer(
    savedRecipeLibraryReducer,
    key,
    createSavedRecipeLibraryState,
  );
  const {
    error,
    focusStatus,
    loading,
    operationError,
    page,
    removingId,
    snapshotId,
    status,
  } = currentSavedRecipeLibraryState(state, key);
  const beyondLastPage = Boolean(
    page && page.total > 0 && page.items.length === 0,
  );

  useLayoutEffect(() => {
    currentLocationRef.current = { key, pageNumber, snapshotId };
  }, [key, pageNumber, snapshotId]);

  const load = useCallback(
    async (requestedPage: number, signal?: AbortSignal) => {
      if (signal?.aborted) return;
      const requestKey = locationKey(requestedPage);
      const requestId = ++requestSequence.current;
      dispatch({ key: requestKey, requestId, type: "load_started" });
      try {
        const result = await fetchSavedRecipeLibrary({
          page: requestedPage,
          pageSize: 12,
          signal,
        });
        if (requestId !== requestSequence.current || signal?.aborted) return;
        dispatch({
          key: requestKey,
          page: result,
          requestId,
          snapshotId: requestId,
          type: "load_succeeded",
        });
      } catch (reason) {
        if (
          isAbortError(reason) ||
          requestId !== requestSequence.current ||
          signal?.aborted
        ) {
          return;
        }
        dispatch({
          key: requestKey,
          message: reason instanceof RecipeLibraryApiError
            ? reason.message
            : "Recipe Lab could not load your saved recipes. Please try again.",
          requestId,
          type: "load_failed",
        });
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ key, type: "location_changed" });
    void Promise.resolve().then(() => load(pageNumber, controller.signal));
    return () => controller.abort();
  }, [key, load, pageNumber]);

  useEffect(() => {
    if (status && focusStatus) statusRef.current?.focus();
  }, [focusStatus, status]);

  async function removeSaved(recipeVersionId: string, title: string) {
    if (snapshotId === null || !page || removingId) return;
    const attemptId = ++removalSequence.current;
    const existingAttempt = removeAttempts.current.get(recipeVersionId);
    const idempotencyKey =
      existingAttempt?.idempotencyKey ?? createIdempotencyKey();
    const attempt: SavedRecipeRemovalAttempt = {
      attemptId,
      originKey: key,
      originSnapshotId: snapshotId,
      recipeVersionId,
    };
    removeAttempts.current.set(recipeVersionId, { attemptId, idempotencyKey });
    activeRemovalRef.current = attempt;
    dispatch({ attempt, type: "removal_started" });

    try {
      await setRecipeSaved(recipeVersionId, false, idempotencyKey);
      if (
        removeAttempts.current.get(recipeVersionId)?.attemptId === attemptId
      ) {
        removeAttempts.current.delete(recipeVersionId);
      }
      const currentLocation = currentLocationRef.current;
      if (
        activeRemovalRef.current?.attemptId !== attemptId ||
        currentLocation.key !== attempt.originKey ||
        currentLocation.snapshotId !== attempt.originSnapshotId
      ) {
        await load(currentLocation.pageNumber);
        return;
      }

      const targetPage =
        page.items.length === 1 && pageNumber > 1
          ? pageNumber - 1
          : pageNumber;
      dispatch({
        attempt,
        message: `${title} removed from Saved.`,
        targetKey: locationKey(targetPage),
        type: "removal_succeeded",
      });
      if (targetPage !== pageNumber) {
        router.replace(myRecipesHref("saved", targetPage));
      }
    } catch {
      const currentLocation = currentLocationRef.current;
      if (
        activeRemovalRef.current?.attemptId === attemptId &&
        currentLocation.key === attempt.originKey &&
        currentLocation.snapshotId === attempt.originSnapshotId
      ) {
        dispatch({
          attempt,
          message:
            "We couldn’t remove this saved recipe. Your saved list is unchanged.",
          type: "removal_failed",
        });
      }
    } finally {
      if (activeRemovalRef.current?.attemptId === attemptId) {
        activeRemovalRef.current = null;
      }
      dispatch({ attemptId, type: "removal_finished" });
    }
  }

  return (
    <main
      id="main-content"
      className="page-shell account-workspace-page account-saved-recipes-page member-library"
    >
      <MyRecipesHubHeader />

      <div className="member-library__frame">
        <MyRecipesHubNavigation
          activeCount={page && !beyondLastPage ? page.total : null}
          activeView="saved"
        />
        <WorkspacePanelHeader
          description="Recipes you’ve saved to come back to later."
          headingId="saved-recipes-list-heading"
          meta={
            page && !beyondLastPage ? (
              <span aria-live="polite">
                {page.total} saved {page.total === 1 ? "recipe" : "recipes"}
              </span>
            ) : null
          }
          title="Saved recipes"
        />

        <div className="member-library__content">
          {status ? (
            <p className="form-status" role="status" tabIndex={-1} ref={statusRef}>
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
                onClick={() => void load(pageNumber)}
              >
                Refresh saved recipes
              </button>
            </div>
          ) : null}
          {loading ? (
            <SectionLoading
              count={4}
              label={
                page
                  ? "Updating your saved recipes…"
                  : "Loading your saved recipes…"
              }
              layout="cards"
              refreshing={Boolean(page)}
            />
          ) : null}
          {!loading && page?.total === 0 ? (
            <WorkspaceEmptyState
              action={
                <GuardedLink className="button button--primary" href="/recipes">
                  Explore recipes
                </GuardedLink>
              }
              description="Use “Save recipe” on a public recipe to keep it in this private list."
              headingId="empty-saves-title"
              title="You have no saved recipes yet."
            />
          ) : null}
          {!loading && beyondLastPage && page ? (
            <section
              className="empty-state"
              aria-labelledby="stale-saves-title"
            >
              <h2 id="stale-saves-title">
                That page is beyond your saved recipes.
              </h2>
              <p>
                Your saved collection currently has {page.total_pages} pages.
              </p>
              <GuardedLink
                className="button button--secondary"
                href={myRecipesHref("saved")}
              >
                Return to the first page
              </GuardedLink>
            </section>
          ) : null}

          {page && !beyondLastPage && page.items.length > 0 ? (
            <>
              <section
                className="member-library__collection"
                aria-labelledby="saved-recipes-list-heading"
              >
                <ul
                  className="recipe-grid member-library__grid"
                  aria-label="Saved recipes"
                  aria-busy={loading}
                >
                  {page.items.map((item) => (
                    <MemberRecipeCard
                      key={item.recipe.id}
                      actions={
                        <LoadingButton
                          aria-label={
                            removingId === item.recipe.id
                              ? `Removing saved ${item.recipe.title}…`
                              : `Remove saved ${item.recipe.title}`
                          }
                          className="button button--quiet"
                          type="button"
                          disabled={removingId !== null && removingId !== item.recipe.id}
                          pending={removingId === item.recipe.id}
                          pendingLabel="Removing…"
                          onClick={() =>
                            void removeSaved(
                              item.recipe.id,
                              item.recipe.title,
                            )
                          }
                        >
                          Remove saved
                        </LoadingButton>
                      }
                      recipe={item.recipe}
                      savedAt={item.saved_at}
                      state="saved"
                    />
                  ))}
                </ul>
              </section>
              <SavedRecipePagination
                currentPage={page.page}
                loading={loading}
                totalPages={page.total_pages}
              />
            </>
          ) : null}
        </div>
      </div>

    </main>
  );
}
