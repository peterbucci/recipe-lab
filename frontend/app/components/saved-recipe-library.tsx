"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "../../lib/abort-error";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import { setRecipeSaved } from "../../lib/interaction-api";
import {
  fetchSavedRecipeLibrary,
  RecipeLibraryApiError,
  type SavedRecipeLibraryPage,
} from "../../lib/recipe-library-api";
import { MemberRouteGate } from "./member-route-gate";
import {
  MyRecipesHubHeader,
  MyRecipesHubNavigation,
} from "./my-recipes-hub";
import { MemberRecipeCard } from "./member-recipe-card";
import { GuardedLink } from "./navigation-blocker-provider";
import { PrivateLibraryPagination } from "./private-library-pagination";
import { LoadingButton, SectionLoading } from "./loading-ui";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspacePanelHeader } from "./workspace-panel-header";

const RETURN_TO = "/account/recipes?view=saved";

function SavedRecipeLibraryInner() {
  const removeAttempts = useRef(new Map<string, string>());
  const statusRef = useRef<HTMLParagraphElement>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<SavedRecipeLibraryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [operationError, setOperationError] = useState("");
  const [status, setStatus] = useState("");
  const [removingId, setRemovingId] = useState<string | null>(null);
  const beyondLastPage = Boolean(
    page && page.total > 0 && page.items.length === 0,
  );

  const load = useCallback(
    async (requestedPage: number, signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const result = await fetchSavedRecipeLibrary({
          page: requestedPage,
          pageSize: 12,
          signal,
        });
        setPage(result);
        setPageNumber(result.page);
      } catch (reason) {
        if (isAbortError(reason))
          return;
        setError(
          reason instanceof RecipeLibraryApiError
            ? reason.message
            : "Recipe Lab could not load your saved recipes. Please try again.",
        );
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetchSavedRecipeLibrary({
      page: pageNumber,
      pageSize: 12,
      signal: controller.signal,
    })
      .then((result) => {
        setPage(result);
        setPageNumber(result.page);
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason))
          return;
        setError(
          reason instanceof RecipeLibraryApiError
            ? reason.message
            : "Recipe Lab could not load your saved recipes. Please try again.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pageNumber]);

  function changePage(nextPage: number) {
    setLoading(true);
    setError("");
    setOperationError("");
    setStatus("");
    setPageNumber(nextPage);
  }

  useEffect(() => {
    if (status) statusRef.current?.focus();
  }, [status]);

  async function removeSaved(recipeVersionId: string, title: string) {
    if (removingId) return;
    setRemovingId(recipeVersionId);
    setOperationError("");
    setStatus("");
    const idempotencyKey =
      removeAttempts.current.get(recipeVersionId) ?? createIdempotencyKey();
    removeAttempts.current.set(recipeVersionId, idempotencyKey);

    try {
      await setRecipeSaved(recipeVersionId, false, idempotencyKey);
      removeAttempts.current.delete(recipeVersionId);
      const nextTotal = Math.max(0, (page?.total ?? 1) - 1);
      const nextTotalPages = Math.ceil(nextTotal / (page?.page_size ?? 12));

      if (page?.items.length === 1 && pageNumber > 1) {
        setStatus(`${title} removed from Saved.`);
        setLoading(true);
        setPageNumber(pageNumber - 1);
        return;
      }

      setPage((current) =>
        current
          ? {
              ...current,
              items: current.items.filter(
                (item) => item.recipe.id !== recipeVersionId,
              ),
              total: nextTotal,
              total_pages: nextTotalPages,
            }
          : current,
      );
      setStatus(`${title} removed from Saved.`);
    } catch {
      setOperationError(
        "We couldn’t remove this saved recipe. Your saved list is unchanged.",
      );
    } finally {
      setRemovingId(null);
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
              <button
                className="button button--secondary"
                type="button"
                onClick={() => changePage(1)}
              >
                Return to the first page
              </button>
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
              <PrivateLibraryPagination
                currentPage={page.page}
                label="Saved recipe pages"
                loading={loading}
                onPageChange={changePage}
                totalPages={page.total_pages}
              />
            </>
          ) : null}
        </div>
      </div>

    </main>
  );
}

export function SavedRecipeLibrary() {
  return (
    <MemberRouteGate
      anonymousHeading="Sign in to open My recipes"
      anonymousMessage="Your drafts, saves, and other private recipe activity belong only to your account."
      eyebrow="Your recipe workspace"
      returnTo={RETURN_TO}
      title="My recipes"
    >
      <SavedRecipeLibraryInner />
    </MemberRouteGate>
  );
}
