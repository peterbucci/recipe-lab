"use client";

import { useCallback, useEffect, useState } from "react";

import {
  fetchSavedRecipeLibrary,
  RecipeLibraryApiError,
  type SavedRecipeLibraryPage,
} from "../../lib/recipe-library-api";
import { MemberRouteGate } from "./member-route-gate";
import { GuardedLink } from "./navigation-blocker-provider";
import { PrivateLibraryPagination } from "./private-library-pagination";
import { RecipeCard } from "./recipe-card";

const RETURN_TO = "/account/saved-recipes";

function SavedRecipeLibraryInner() {
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<SavedRecipeLibraryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beyondLastPage = Boolean(page && page.total > 0 && page.items.length === 0);

  const load = useCallback(async (requestedPage: number, signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchSavedRecipeLibrary({ page: requestedPage, pageSize: 12, signal });
      setPage(result);
      setPageNumber(result.page);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(
        reason instanceof RecipeLibraryApiError
          ? reason.message
          : "Recipe Lab could not load your saved recipes. Please try again.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchSavedRecipeLibrary({ page: pageNumber, pageSize: 12, signal: controller.signal })
      .then((result) => {
        setPage(result);
        setPageNumber(result.page);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
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
    setPageNumber(nextPage);
  }

  return (
    <main id="main-content" className="page-shell member-library">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <GuardedLink href="/recipes">← Back to recipes</GuardedLink>
      </nav>
      <header className="page-intro">
        <p className="eyebrow">Your cookbook</p>
        <h1>Saved recipes</h1>
        <p>Return to the public recipe versions you saved for later.</p>
      </header>
      <p className="member-library__privacy">
        This list belongs to your account. Other cooks cannot see which recipes you saved.
      </p>

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
      {loading && !page ? <p role="status">Loading your saved recipes…</p> : null}
      {!loading && page?.total === 0 ? (
        <section className="empty-state" aria-labelledby="empty-saves-title">
          <p className="eyebrow">Nothing bookmarked</p>
          <h2 id="empty-saves-title">You have no saved recipes yet.</h2>
          <p>Use “Save recipe” on a public recipe to keep it in this private list.</p>
          <GuardedLink className="button button--primary" href="/recipes">
            Explore recipes
          </GuardedLink>
        </section>
      ) : null}
      {!loading && beyondLastPage && page ? (
        <section className="empty-state" aria-labelledby="stale-saves-title">
          <h2 id="stale-saves-title">That page is beyond your saved recipes.</h2>
          <p>Your saved collection currently has {page.total_pages} pages.</p>
          <button className="button button--secondary" type="button" onClick={() => changePage(1)}>
            Return to the first page
          </button>
        </section>
      ) : null}

      {page && !beyondLastPage && page.items.length > 0 ? (
        <>
          <section aria-labelledby="saved-recipes-list-heading">
            <div className="section-heading section-heading--compact">
              <div>
                <h2 id="saved-recipes-list-heading">Your saved collection</h2>
                <p className="result-count" aria-live="polite">
                  {page.total} saved {page.total === 1 ? "recipe" : "recipes"}
                </p>
              </div>
            </div>
            <ul className="recipe-grid" aria-label="Saved recipes" aria-busy={loading}>
              {page.items.map((item) => (
                <RecipeCard key={item.recipe.id} recipe={item.recipe} />
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
    </main>
  );
}

export function SavedRecipeLibrary() {
  return (
    <MemberRouteGate eyebrow="Your cookbook" returnTo={RETURN_TO} title="Saved recipes">
      <SavedRecipeLibraryInner />
    </MemberRouteGate>
  );
}
