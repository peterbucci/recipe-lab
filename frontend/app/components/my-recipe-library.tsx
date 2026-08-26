"use client";

import { useCallback, useEffect, useState } from "react";

import {
  fetchMyRecipeLibrary,
  RecipeLibraryApiError,
  type MyRecipeLibraryPage,
} from "../../lib/recipe-library-api";
import { MemberRouteGate } from "./member-route-gate";
import { GuardedLink } from "./navigation-blocker-provider";
import { PrivateLibraryPagination } from "./private-library-pagination";
import { RecipeCard } from "./recipe-card";

const RETURN_TO = "/account/recipes";

function formatActivity(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(timestamp));
}

function MyRecipeLibraryInner() {
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<MyRecipeLibraryPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const beyondLastPage = Boolean(page && page.total > 0 && page.items.length === 0);

  const load = useCallback(async (requestedPage: number, signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchMyRecipeLibrary({ page: requestedPage, pageSize: 12, signal });
      setPage(result);
      setPageNumber(result.page);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError(
        reason instanceof RecipeLibraryApiError
          ? reason.message
          : "Recipe Lab could not load your recipes. Please try again.",
      );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void fetchMyRecipeLibrary({ page: pageNumber, pageSize: 12, signal: controller.signal })
      .then((result) => {
        setPage(result);
        setPageNumber(result.page);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError(
          reason instanceof RecipeLibraryApiError
            ? reason.message
            : "Recipe Lab could not load your recipes. Please try again.",
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
      <header className="page-intro member-library__intro">
        <div>
          <p className="eyebrow">Your recipe workspace</p>
          <h1>My recipes</h1>
          <p>Find your current private drafts, published originals, and published forks.</p>
        </div>
        <GuardedLink className="button button--primary" href="/recipes/new">
          Start a new recipe
        </GuardedLink>
      </header>
      <p className="member-library__privacy">
        Private drafts are visible only to you. Published entries open the public version that
        everyone can read.
      </p>

      {error ? (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => void load(pageNumber)}
          >
            Refresh my recipes
          </button>
        </div>
      ) : null}
      {loading && !page ? <p role="status">Loading your recipes…</p> : null}
      {!loading && page?.total === 0 ? (
        <section className="empty-state" aria-labelledby="empty-my-recipes-title">
          <p className="eyebrow">A clean workbench</p>
          <h2 id="empty-my-recipes-title">You have no recipes yet.</h2>
          <p>Start an original recipe, or make your own version of a public recipe.</p>
          <div className="button-row">
            <GuardedLink className="button button--primary" href="/recipes/new">
              Start a new recipe
            </GuardedLink>
            <GuardedLink className="button button--secondary" href="/recipes">
              Explore recipes
            </GuardedLink>
          </div>
        </section>
      ) : null}
      {!loading && beyondLastPage && page ? (
        <section className="empty-state" aria-labelledby="stale-my-recipes-title">
          <h2 id="stale-my-recipes-title">That page is beyond your recipes.</h2>
          <p>Your library currently has {page.total_pages} pages.</p>
          <button className="button button--secondary" type="button" onClick={() => changePage(1)}>
            Return to the first page
          </button>
        </section>
      ) : null}

      {page && !beyondLastPage && page.items.length > 0 ? (
        <>
          <section aria-labelledby="my-recipes-list-heading">
            <div className="section-heading section-heading--compact">
              <div>
                <h2 id="my-recipes-list-heading">Your recipe activity</h2>
                <p className="result-count" aria-live="polite">
                  {page.total} {page.total === 1 ? "recipe" : "recipes and drafts"}
                </p>
              </div>
            </div>
            <ul className="recipe-grid member-library__grid" aria-label="My recipes" aria-busy={loading}>
              {page.items.map((item) => {
                if (item.kind === "published") {
                  return <RecipeCard key={`published-${item.recipe.id}`} recipe={item.recipe} />;
                }
                const draft = item.draft;
                const title = draft.title.trim() || "Untitled recipe";
                return (
                  <li className="member-library__draft-card" key={`draft-${draft.id}`}>
                    <article aria-labelledby={`my-draft-${draft.id}`}>
                      <div className="member-library__card-meta">
                        <span>{draft.source_version_id ? "Fork draft" : "Original draft"}</span>
                        <span>Private</span>
                      </div>
                      <h3 id={`my-draft-${draft.id}`}>{title}</h3>
                      <p>
                        {draft.ingredient_count} ingredient{draft.ingredient_count === 1 ? "" : "s"}
                        {" · "}
                        {draft.instruction_count} step{draft.instruction_count === 1 ? "" : "s"}
                      </p>
                      <p>
                        Updated <time dateTime={draft.updated_at}>{formatActivity(draft.updated_at)}</time>
                      </p>
                      <div className="button-row">
                        <GuardedLink
                          className="button button--primary"
                          href={`/account/recipe-drafts/${draft.id}`}
                        >
                          Resume draft
                        </GuardedLink>
                        {draft.source_version_id ? (
                          <GuardedLink
                            className="button button--quiet"
                            href={`/recipes/${draft.source_version_id}`}
                          >
                            View source
                          </GuardedLink>
                        ) : null}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>
          <PrivateLibraryPagination
            currentPage={page.page}
            label="My recipe pages"
            loading={loading}
            onPageChange={changePage}
            totalPages={page.total_pages}
          />
        </>
      ) : null}
    </main>
  );
}

export function MyRecipeLibrary() {
  return (
    <MemberRouteGate eyebrow="Your recipe workspace" returnTo={RETURN_TO} title="My recipes">
      <MyRecipeLibraryInner />
    </MemberRouteGate>
  );
}
