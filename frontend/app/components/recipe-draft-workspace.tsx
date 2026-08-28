"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AuthApiError } from "../../lib/auth-api";
import { createIdempotencyKey } from "../../lib/idempotency-key";
import {
  browseRecipeDrafts,
  discardRecipeDraft,
  RecipeDraftApiError,
  type RecipeDraftPage,
} from "../../lib/recipe-draft-api";
import { MemberRouteGate } from "./member-route-gate";
import { GuardedLink } from "./navigation-blocker-provider";

const RETURN_TO = "/account/recipe-drafts";
const DISCARD_COPY =
  "Discard permanently deletes this draft and its private content immediately. It cannot be restored.";

function formatUpdatedAt(timestamp: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function RecipeDraftWorkspaceInner() {
  const [pageNumber, setPageNumber] = useState(1);
  const [page, setPage] = useState<RecipeDraftPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  const discardAttempts = useRef(new Map<string, string>());
  const discardInFlight = useRef(false);

  const load = useCallback(async (requestedPage: number, signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    try {
      const result = await browseRecipeDrafts({ page: requestedPage, pageSize: 12, signal });
      setPage(result);
      setPageNumber(result.page);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      setError("Recipe Lab could not load your private drafts. Please try again.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void browseRecipeDrafts({ page: pageNumber, pageSize: 12, signal: controller.signal })
      .then((result) => {
        setPage(result);
        setPageNumber(result.page);
      })
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === "AbortError") return;
        setError("Recipe Lab could not load your private drafts. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [pageNumber]);

  async function discard(id: string, revision: number, title: string) {
    if (discardInFlight.current || discardingId) return;
    discardInFlight.current = true;
    setDiscardingId(id);
    setError("");
    setStatus("");
    const key = discardAttempts.current.get(id) ?? createIdempotencyKey();
    discardAttempts.current.set(id, key);
    try {
      await discardRecipeDraft(id, revision, key);
      discardAttempts.current.delete(id);
      setConfirmingId(null);
      setStatus(`${title || "Untitled recipe"} was permanently discarded.`);
      const targetPage = page?.items.length === 1 && pageNumber > 1 ? pageNumber - 1 : pageNumber;
      if (targetPage === pageNumber) await load(targetPage);
      else setPageNumber(targetPage);
    } catch (reason) {
      if (reason instanceof RecipeDraftApiError && reason.code === "recipe_draft_revision_conflict") {
        setError("This draft changed in another tab. It was not discarded. Refresh the list and review it first.");
      } else if (
        (reason instanceof RecipeDraftApiError || reason instanceof AuthApiError) &&
        reason.status === 401
      ) {
        setError("Your session expired. This draft was not discarded. Sign in again to continue.");
      } else {
        setError("Recipe Lab could not discard this draft. It is still private and intact.");
      }
    } finally {
      discardInFlight.current = false;
      setDiscardingId(null);
    }
  }

  return (
    <main id="main-content" className="page-shell draft-library">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <GuardedLink href="/recipes">← Back to recipes</GuardedLink>
      </nav>
      <header className="page-intro draft-library__intro">
        <div>
          <p className="eyebrow">Private recipe workspace</p>
          <h1>My recipe drafts</h1>
          <p>Resume an incomplete recipe or start something new. Only you can see these drafts.</p>
        </div>
        <GuardedLink className="button button--primary" href="/recipes/new">
          Start a new recipe
        </GuardedLink>
      </header>

      <p className="draft-library__privacy">
        Drafts do not appear in public recipes, search, ratings, saves, or activity.
      </p>
      {status ? <p className="form-status" role="status">{status}</p> : null}
      {error ? (
        <div className="form-alert" role="alert">
          <p>{error}</p>
          <button className="button button--secondary" type="button" onClick={() => void load(pageNumber)}>
            Refresh drafts
          </button>
        </div>
      ) : null}

      {loading && !page ? <p role="status">Loading your private drafts…</p> : null}
      {!loading && page?.items.length === 0 ? (
        <section className="empty-state" aria-labelledby="empty-drafts-title">
          <p className="eyebrow">A clean workbench</p>
          <h2 id="empty-drafts-title">You have no private drafts yet.</h2>
          <p>Start an original recipe, or choose “Make your own version” on any public recipe.</p>
          <GuardedLink className="button button--primary" href="/recipes/new">Start a new recipe</GuardedLink>
        </section>
      ) : null}

      {page && page.items.length > 0 ? (
        <>
          <ul className="draft-library__list" aria-busy={loading} aria-label="Private recipe drafts">
            {page.items.map((draft) => {
              const label = draft.title.trim() || "Untitled recipe";
              const confirming = confirmingId === draft.id;
              return (
                <li key={draft.id} className="draft-library__card">
                  <div className="draft-library__card-heading">
                    <div>
                      <span className="draft-library__kind">{draft.source_version_id ? "Your version draft" : "Original recipe draft"}</span>
                      <h2>{label}</h2>
                    </div>
                    <span>Private</span>
                  </div>
                  <p>
                    {draft.ingredient_count} ingredient{draft.ingredient_count === 1 ? "" : "s"} · {draft.instruction_count} step{draft.instruction_count === 1 ? "" : "s"}
                  </p>
                  <p className="draft-library__updated">
                    Updated <time dateTime={draft.updated_at}>{formatUpdatedAt(draft.updated_at)}</time>
                  </p>
                  <div className="button-row">
                    <GuardedLink className="button button--primary" href={`/account/recipe-drafts/${draft.id}`}>
                      Resume draft
                    </GuardedLink>
                    {draft.source_version_id ? (
                      <GuardedLink className="button button--quiet" href={`/recipes/${draft.source_version_id}`}>
                        View source
                      </GuardedLink>
                    ) : null}
                    <button className="button button--quiet" type="button" aria-expanded={confirming} aria-controls={`discard-${draft.id}`} onClick={() => setConfirmingId(confirming ? null : draft.id)}>
                      Discard
                    </button>
                  </div>
                  {confirming ? (
                    <div id={`discard-${draft.id}`} className="draft-discard" role="group" aria-label={`Discard ${label}`}>
                      <p><strong>Discard {label}?</strong></p>
                      <p>{DISCARD_COPY}</p>
                      <div className="button-row">
                        <button className="button button--danger" type="button" disabled={discardingId === draft.id} onClick={() => void discard(draft.id, draft.revision, label)}>
                          {discardingId === draft.id ? "Discarding…" : "Discard permanently"}
                        </button>
                        <button className="button button--secondary" type="button" disabled={discardingId === draft.id} onClick={() => setConfirmingId(null)}>Keep draft</button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {page.total_pages > 1 ? (
            <nav className="pagination" aria-label="Draft pages">
              <button className="button button--secondary" type="button" disabled={loading || page.page <= 1} onClick={() => { setLoading(true); setError(""); setPageNumber(page.page - 1); }}>← Previous</button>
              <span className="pagination__status" aria-current="page">Page {page.page} of {page.total_pages}</span>
              <button className="button button--secondary" type="button" disabled={loading || page.page >= page.total_pages} onClick={() => { setLoading(true); setError(""); setPageNumber(page.page + 1); }}>Next →</button>
            </nav>
          ) : null}
        </>
      ) : null}
    </main>
  );
}

export function RecipeDraftWorkspace() {
  return (
    <MemberRouteGate eyebrow="Private recipe workspace" returnTo={RETURN_TO} title="My recipe drafts">
      <RecipeDraftWorkspaceInner />
    </MemberRouteGate>
  );
}
