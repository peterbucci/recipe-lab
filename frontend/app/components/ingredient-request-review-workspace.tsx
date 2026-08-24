"use client";

import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  browseIngredientCatalogReviewRequests,
  type CatalogIngredientPage,
  type DuplicateIngredientCatalogRequestInput,
  fetchIngredientCatalogReviewDetail,
  type IngredientCatalogRequestStatus,
  IngredientCatalogApiError,
  type IngredientCatalogReviewDetail,
  type IngredientCatalogReviewInput,
  type IngredientCatalogReviewItem,
  type IngredientCatalogReviewPage,
  reviewIngredientCatalogRequest,
  searchCatalogIngredients,
} from "../../lib/ingredient-catalog-api";
import { useAuthSession } from "./auth-session-provider";

const STATUS_FILTERS: Array<{
  label: string;
  value: IngredientCatalogRequestStatus;
}> = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Rejected", value: "rejected" },
  { label: "Duplicate", value: "duplicate" },
];

const STATUS_LABELS: Record<IngredientCatalogRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  duplicate: "Duplicate",
};

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function formatRequestTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function unavailablePage() {
  return (
    <main id="main-content" className="state-page">
      <div className="error-state" role="alert">
        <p className="eyebrow">Page unavailable</p>
        <h1>We couldn’t find that page.</h1>
        <p>Browse the recipe collection to find something to cook.</p>
        <Link className="button button--primary" href="/recipes">
          Browse recipes
        </Link>
      </div>
    </main>
  );
}

export function IngredientRequestReviewWorkspace() {
  const { state, refreshSession } = useAuthSession();
  const [authorizationLost, setAuthorizationLost] = useState(false);

  const handleAuthorizationLost = useCallback(() => {
    setAuthorizationLost(true);
    void refreshSession();
  }, [refreshSession]);

  if (state.phase === "loading") {
    return (
      <main id="main-content" className="state-page">
        <div className="loading-state" role="status" aria-live="polite">
          <span className="loading-state__pulse" aria-hidden="true" />
          <strong>Checking review access…</strong>
          <span>Loading your account permissions.</span>
        </div>
      </main>
    );
  }

  if (state.phase === "error") {
    return (
      <main id="main-content" className="state-page">
        <div className="error-state" role="alert">
          <p className="eyebrow">Account unavailable</p>
          <h1>We couldn’t check access.</h1>
          <p>Try checking your account again, or return to the recipe collection.</p>
          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              onClick={() => void refreshSession()}
            >
              Try again
            </button>
            <Link className="button button--secondary" href="/recipes">
              Browse recipes
            </Link>
          </div>
        </div>
      </main>
    );
  }

  if (
    authorizationLost ||
    state.session.status !== "authenticated" ||
    !state.session.capabilities?.review_ingredient_requests
  ) {
    return unavailablePage();
  }

  return <AuthorizedReviewWorkspace onAuthorizationLost={handleAuthorizationLost} />;
}

function AuthorizedReviewWorkspace({
  onAuthorizationLost,
}: {
  onAuthorizationLost: () => void;
}) {
  const [requestStatus, setRequestStatus] =
    useState<IngredientCatalogRequestStatus>("pending");
  const [pageNumber, setPageNumber] = useState(1);
  const [queue, setQueue] = useState<IngredientCatalogReviewPage | null>(null);
  const [queueError, setQueueError] = useState("");
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueReload, setQueueReload] = useState(0);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const selectedRequestIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<IngredientCatalogReviewDetail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const workspaceStatusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void browseIngredientCatalogReviewRequests({
      status: requestStatus,
      page: pageNumber,
      pageSize: 20,
      signal: controller.signal,
    })
      .then((result) => {
        setQueue(result);
        const current = selectedRequestIdRef.current;
        const next =
          current && result.items.some((item) => item.id === current)
            ? current
            : (result.items[0]?.id ?? null);
        if (next !== current) {
          selectRequest(next);
        }
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason)) {
          return;
        }
        setQueue(null);
        setSelectedRequestId(null);
        if (reason instanceof IngredientCatalogApiError && reason.status === 403) {
          onAuthorizationLost();
          return;
        }
        setQueueError("The ingredient review queue could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setQueueLoading(false);
        }
      });
    return () => controller.abort();
  }, [onAuthorizationLost, pageNumber, queueReload, requestStatus]);

  const loadDetail = useCallback(
    async (requestId: string, signal?: AbortSignal) => {
      try {
        const result = await fetchIngredientCatalogReviewDetail(requestId, signal);
        setDetail(result);
        setDetailError("");
      } catch (reason) {
        if (isAbortError(reason)) {
          return;
        }
        if (reason instanceof IngredientCatalogApiError && reason.status === 403) {
          onAuthorizationLost();
          return;
        }
        setDetailError("This ingredient request could not be loaded. Please try again.");
      }
    },
    [onAuthorizationLost],
  );

  useEffect(() => {
    if (!selectedRequestId) {
      return;
    }
    const controller = new AbortController();
    void fetchIngredientCatalogReviewDetail(selectedRequestId, controller.signal)
      .then((result) => {
        setDetail(result);
        setDetailError("");
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason)) {
          return;
        }
        if (reason instanceof IngredientCatalogApiError && reason.status === 403) {
          onAuthorizationLost();
          return;
        }
        setDetailError("This ingredient request could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setDetailLoading(false);
        }
      });
    return () => controller.abort();
  }, [onAuthorizationLost, selectedRequestId]);

  async function refreshDetail() {
    if (!selectedRequestId) {
      return;
    }
    setDetailLoading(true);
    await loadDetail(selectedRequestId);
    setDetailLoading(false);
  }

  function selectRequest(requestId: string | null) {
    selectedRequestIdRef.current = requestId;
    setSelectedRequestId(requestId);
    setDetail(null);
    setDetailError("");
    setDetailLoading(requestId !== null);
  }

  function reloadQueue() {
    setQueueLoading(true);
    setQueueError("");
    setQueueReload((value) => value + 1);
  }

  function changePage(nextPage: number) {
    setQueueLoading(true);
    setQueueError("");
    setPageNumber(nextPage);
  }

  function changeStatus(nextStatus: IngredientCatalogRequestStatus) {
    if (nextStatus === requestStatus) {
      return;
    }
    setRequestStatus(nextStatus);
    setPageNumber(1);
    setQueueLoading(true);
    setQueueError("");
    setQueue(null);
    selectRequest(null);
    setWorkspaceStatus("");
  }

  function handleReviewed(updated: IngredientCatalogReviewItem) {
    setWorkspaceStatus(
      `${updated.proposed_name} is now ${STATUS_LABELS[updated.status].toLocaleLowerCase()}.`,
    );
    setDetail((current) => (current?.id === updated.id ? { ...current, ...updated } : current));
    reloadQueue();
    window.setTimeout(() => workspaceStatusRef.current?.focus(), 0);
  }

  return (
    <main id="main-content" className="page-shell curation-page">
      <header className="page-intro curation-page__intro">
        <p className="eyebrow">Catalog curation</p>
        <h1>Review ingredient requests.</h1>
        <p>
          Make one accountable decision for each request. Candidate matches are suggestions only;
          they never establish ingredient identity automatically.
        </p>
      </header>

      <nav className="curation-filters" aria-label="Ingredient request status filters">
        {STATUS_FILTERS.map((filter) => (
          <button
            className="curation-filter"
            type="button"
            key={filter.value}
            aria-pressed={requestStatus === filter.value}
            onClick={() => changeStatus(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </nav>

      {workspaceStatus ? (
        <div
          ref={workspaceStatusRef}
          className="curation-success-summary"
          role="status"
          aria-live="polite"
          tabIndex={-1}
        >
          <strong>Decision saved.</strong>
          <span>{workspaceStatus}</span>
        </div>
      ) : null}

      <div className="curation-workspace">
        <section className="curation-queue" aria-labelledby="curation-queue-heading">
          <div className="curation-panel-heading">
            <div>
              <p className="eyebrow">{STATUS_LABELS[requestStatus]}</p>
              <h2 id="curation-queue-heading">Request queue</h2>
            </div>
            {queue ? (
              <span>
                {queue.total} request{queue.total === 1 ? "" : "s"}
              </span>
            ) : null}
          </div>

          {queueLoading ? (
            <div className="curation-panel-state" role="status">
              Loading {STATUS_LABELS[requestStatus].toLocaleLowerCase()} requests…
            </div>
          ) : null}
          {queueError ? (
            <div className="curation-panel-state" role="alert">
              <p>{queueError}</p>
              <button
                className="button button--secondary"
                type="button"
                onClick={reloadQueue}
              >
                Try again
              </button>
            </div>
          ) : null}
          {!queueLoading && !queueError && queue?.items.length === 0 ? (
            <div className="curation-panel-state">
              <strong>No {STATUS_LABELS[requestStatus].toLocaleLowerCase()} requests.</strong>
              <p>Choose another status to review a different part of the queue.</p>
            </div>
          ) : null}
          {queue && queue.items.length > 0 ? (
            <ol className="curation-request-list" aria-label={`${STATUS_LABELS[requestStatus]} requests`}>
              {queue.items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-pressed={selectedRequestId === item.id}
                    onClick={() => selectRequest(item.id)}
                  >
                    <span className={`curation-status curation-status--${item.status}`}>
                      {STATUS_LABELS[item.status]}
                    </span>
                    <strong>{item.proposed_name}</strong>
                    <small>
                      Submitted {formatRequestTime(item.created_at)}
                    </small>
                  </button>
                </li>
              ))}
            </ol>
          ) : null}
          {queue && queue.total_pages > 1 ? (
            <nav className="curation-pagination" aria-label="Ingredient request pages">
              <button
                className="button button--quiet"
                type="button"
                disabled={queueLoading || queue.page <= 1}
                onClick={() => changePage(queue.page - 1)}
              >
                ← Previous
              </button>
              <span aria-current="page">
                Page {queue.page} of {queue.total_pages}
              </span>
              <button
                className="button button--quiet"
                type="button"
                disabled={queueLoading || queue.page >= queue.total_pages}
                onClick={() => changePage(queue.page + 1)}
              >
                Next →
              </button>
            </nav>
          ) : null}
        </section>

        <section className="curation-detail" aria-labelledby="curation-detail-heading">
          {!selectedRequestId && !queueLoading ? (
            <div className="curation-panel-state">
              <h2 id="curation-detail-heading">Choose a request</h2>
              <p>Select a request from the queue to see its review details.</p>
            </div>
          ) : null}
          {detailLoading ? (
            <div className="curation-panel-state" role="status">
              Loading request details…
            </div>
          ) : null}
          {detailError ? (
            <div className="curation-panel-state" role="alert">
              <h2 id="curation-detail-heading">Request unavailable</h2>
              <p>{detailError}</p>
              <button
                className="button button--secondary"
                type="button"
                onClick={() => void refreshDetail()}
              >
                Try again
              </button>
            </div>
          ) : null}
          {detail ? (
            <IngredientRequestReviewDetail
              key={detail.id}
              detail={detail}
              onAuthorizationLost={onAuthorizationLost}
              onRefresh={refreshDetail}
              onReviewed={handleReviewed}
            />
          ) : null}
        </section>
      </div>
    </main>
  );
}

interface ReviewDetailProps {
  detail: IngredientCatalogReviewDetail;
  onAuthorizationLost: () => void;
  onRefresh: () => Promise<void>;
  onReviewed: (request: IngredientCatalogReviewItem) => void;
}

function IngredientRequestReviewDetail(props: ReviewDetailProps) {
  const { detail } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [detail.id]);

  return (
    <article className="curation-detail__article" aria-labelledby="curation-detail-heading">
      <header className="curation-detail__header">
        <div>
          <span className={`curation-status curation-status--${detail.status}`}>
            {STATUS_LABELS[detail.status]}
          </span>
          <h2 id="curation-detail-heading" ref={headingRef} tabIndex={-1}>
            {detail.proposed_name}
          </h2>
        </div>
        <time dateTime={detail.created_at}>{formatRequestTime(detail.created_at)}</time>
      </header>

      <dl className="curation-request-facts">
        <div>
          <dt>Requested by</dt>
          <dd>
            {detail.requester.display_name}
            {detail.requester.handle ? <span>@{detail.requester.handle}</span> : null}
          </dd>
        </div>
        <div>
          <dt>Request ID</dt>
          <dd className="curation-request-id">{detail.id}</dd>
        </div>
        <div>
          <dt>Last updated</dt>
          <dd>
            <time dateTime={detail.updated_at}>{formatRequestTime(detail.updated_at)}</time>
          </dd>
        </div>
      </dl>

      <section className="curation-context" aria-labelledby="curation-context-heading">
        <h3 id="curation-context-heading">Member context</h3>
        <p>{detail.context ?? "No additional context was provided."}</p>
      </section>

      <CandidateSummary detail={detail} />
      <IngredientRequestDecisionForm {...props} />
    </article>
  );
}

function CandidateSummary({ detail }: { detail: IngredientCatalogReviewDetail }) {
  const candidateCount = detail.catalog_candidates.length + detail.request_candidates.length;
  return (
    <section className="curation-candidates" aria-labelledby="curation-candidates-heading">
      <div className="curation-section-heading">
        <h3 id="curation-candidates-heading">Possible matches</h3>
        <span>{candidateCount}</span>
      </div>
      <p>
        These are review aids only. Similar text does not prove that two ingredients are the same.
      </p>
      {candidateCount === 0 ? (
        <p className="curation-candidates__empty">No likely catalog or request matches were found.</p>
      ) : (
        <ul className="curation-candidate-summary-list">
          {detail.catalog_candidates.map((candidate) => (
            <li key={`catalog-${candidate.id}`}>
              <strong>{candidate.canonical_name}</strong>
              <span>Catalog ingredient</span>
              {candidate.aliases.length ? (
                <small>Aliases: {candidate.aliases.join(", ")}</small>
              ) : null}
            </li>
          ))}
          {detail.request_candidates.map((candidate) => (
            <li key={`request-${candidate.id}`}>
              <strong>{candidate.proposed_name}</strong>
              <span>{STATUS_LABELS[candidate.status]} request</span>
              {candidate.approved_canonical_name ? (
                <small>Approved as: {candidate.approved_canonical_name}</small>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface DuplicateTargetSearchProps {
  detail: IngredientCatalogReviewDetail;
  disabled: boolean;
  inputName: string;
  onSelect: (value: string) => void;
  value: string;
}

function DuplicateTargetSearch({
  detail,
  disabled,
  inputName,
  onSelect,
  value,
}: DuplicateTargetSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const sequenceRef = useRef(0);
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [catalogPage, setCatalogPage] = useState<CatalogIngredientPage | null>(null);
  const [requestPage, setRequestPage] = useState<IngredientCatalogReviewPage | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  useEffect(
    () => () => {
      controllerRef.current?.abort();
    },
    [],
  );

  async function runSearch(nextCatalogPage = 1, nextRequestPage = 1) {
    if (disabled || searching) {
      return;
    }
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
      setSearchError("Enter an ingredient or approved-request name to search.");
      setSearchStatus("");
      inputRef.current?.focus();
      return;
    }

    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setSearching(true);
    setSearchError("");
    setSearchStatus("Searching existing ingredients and approved requests…");
    setSearchedQuery(normalizedQuery);
    setHasSearched(true);
    try {
      const [catalog, requests] = await Promise.all([
        searchCatalogIngredients({
          query: normalizedQuery,
          page: nextCatalogPage,
          pageSize: 10,
          signal: controller.signal,
        }),
        browseIngredientCatalogReviewRequests({
          status: "approved",
          page: nextRequestPage,
          pageSize: 10,
          query: normalizedQuery,
          signal: controller.signal,
        }),
      ]);
      if (sequence !== sequenceRef.current) {
        return;
      }
      setCatalogPage(catalog);
      setRequestPage(requests);
      const total = catalog.total + requests.total;
      setSearchStatus(
        total === 0
          ? `No existing ingredients or approved requests match ${normalizedQuery}.`
          : `${total} possible duplicate target${total === 1 ? "" : "s"} found.`,
      );
    } catch (reason) {
      if (isAbortError(reason) || sequence !== sequenceRef.current) {
        return;
      }
      setSearchError("Duplicate targets could not be searched. Your review is still here.");
      setSearchStatus("");
    } finally {
      if (sequence === sequenceRef.current) {
        setSearching(false);
      }
    }
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void runSearch();
    }
  }

  const suggestedIngredientIds = new Set(
    detail.catalog_candidates.map((candidate) => candidate.id),
  );
  const suggestedRequestIds = new Set(
    detail.request_candidates.map((candidate) => candidate.id),
  );
  const catalogResults =
    catalogPage?.items.filter((candidate) => !suggestedIngredientIds.has(candidate.id)) ?? [];
  const approvedRequestResults =
    requestPage?.items.filter((candidate) => !suggestedRequestIds.has(candidate.id)) ?? [];
  const idPrefix = `catalog-review-${detail.id}-target-search`;

  return (
    <section className="curation-target-search" aria-labelledby={`${idPrefix}-heading`}>
      <h4 id={`${idPrefix}-heading`}>Find another duplicate target</h4>
      <p>
        Search the full curated catalog and previously approved requests. Choosing a result is
        always explicit.
      </p>
      <div
        className="curation-target-search__controls"
        role="search"
        aria-label="Duplicate target search"
      >
        <label htmlFor={`${idPrefix}-input`}>Search duplicate targets</label>
        <div>
          <input
            ref={inputRef}
            id={`${idPrefix}-input`}
            type="search"
            maxLength={100}
            autoComplete="off"
            value={query}
            disabled={disabled}
            aria-describedby={`${idPrefix}-help ${idPrefix}-status`}
            onChange={(event) => {
              controllerRef.current?.abort();
              sequenceRef.current += 1;
              setQuery(event.target.value);
              setCatalogPage(null);
              setRequestPage(null);
              setHasSearched(false);
              setSearching(false);
              setSearchError("");
              setSearchStatus("");
            }}
            onKeyDown={handleSearchKeyDown}
          />
          <button
            className="button button--secondary"
            type="button"
            disabled={disabled || searching}
            onClick={() => void runSearch()}
          >
            {searching ? "Searching…" : "Search"}
          </button>
        </div>
        <small id={`${idPrefix}-help`}>Maximum 100 characters.</small>
      </div>

      {searchError ? (
        <p className="curation-target-search__alert" role="alert">
          {searchError}
        </p>
      ) : null}
      <p id={`${idPrefix}-status`} className="curation-target-search__status" role="status" aria-live="polite">
        {searchStatus}
      </p>

      {hasSearched && catalogPage ? (
        <section className="curation-target-results" aria-labelledby={`${idPrefix}-catalog-heading`}>
          <h5 id={`${idPrefix}-catalog-heading`}>Existing catalog ingredients</h5>
          {catalogResults.length ? (
            <ul>
              {catalogResults.map((candidate) => (
                <li key={candidate.id}>
                  <label>
                    <input
                      type="radio"
                      name={inputName}
                      value={`ingredient:${candidate.id}`}
                      checked={value === `ingredient:${candidate.id}`}
                      onChange={(event) => onSelect(event.target.value)}
                    />
                    <span>
                      <strong>{candidate.canonical_name}</strong>
                      <small>
                        Existing catalog ingredient
                        {candidate.aliases.length ? ` · Aliases: ${candidate.aliases.join(", ")}` : ""}
                      </small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p>No additional catalog ingredients on this page.</p>
          )}
          {catalogPage.total_pages > 1 ? (
            <nav aria-label="Catalog duplicate target pages">
              <button
                className="button button--quiet"
                type="button"
                disabled={searching || catalogPage.page <= 1}
                onClick={() => void runSearch(catalogPage.page - 1, requestPage?.page ?? 1)}
              >
                ← Previous catalog page
              </button>
              <span aria-current="page">
                Catalog page {catalogPage.page} of {catalogPage.total_pages}
              </span>
              <button
                className="button button--quiet"
                type="button"
                disabled={searching || catalogPage.page >= catalogPage.total_pages}
                onClick={() => void runSearch(catalogPage.page + 1, requestPage?.page ?? 1)}
              >
                Next catalog page →
              </button>
            </nav>
          ) : null}
        </section>
      ) : null}

      {hasSearched && requestPage ? (
        <section className="curation-target-results" aria-labelledby={`${idPrefix}-requests-heading`}>
          <h5 id={`${idPrefix}-requests-heading`}>Already-approved requests</h5>
          {approvedRequestResults.length ? (
            <ul>
              {approvedRequestResults.map((candidate) => (
                <li key={candidate.id}>
                  <label>
                    <input
                      type="radio"
                      name={inputName}
                      value={`request:${candidate.id}`}
                      checked={value === `request:${candidate.id}`}
                      onChange={(event) => onSelect(event.target.value)}
                    />
                    <span>
                      <strong>{candidate.approved_canonical_name ?? candidate.proposed_name}</strong>
                      <small>Already-approved request · Proposed as {candidate.proposed_name}</small>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p>No additional approved requests on this page.</p>
          )}
          {requestPage.total_pages > 1 ? (
            <nav aria-label="Approved request duplicate target pages">
              <button
                className="button button--quiet"
                type="button"
                disabled={searching || requestPage.page <= 1}
                onClick={() => void runSearch(catalogPage?.page ?? 1, requestPage.page - 1)}
              >
                ← Previous approved-request page
              </button>
              <span aria-current="page">
                Approved-request page {requestPage.page} of {requestPage.total_pages}
              </span>
              <button
                className="button button--quiet"
                type="button"
                disabled={searching || requestPage.page >= requestPage.total_pages}
                onClick={() => void runSearch(catalogPage?.page ?? 1, requestPage.page + 1)}
              >
                Next approved-request page →
              </button>
            </nav>
          ) : null}
        </section>
      ) : null}

      {hasSearched && searchedQuery !== query.trim() ? (
        <p>Search again to update results for the edited name.</p>
      ) : null}
    </section>
  );
}

interface ReviewFieldErrors {
  aliases?: string;
  canonicalName?: string;
  provenance?: string;
  reason?: string;
  target?: string;
}

type ReviewDecision = IngredientCatalogReviewInput["decision"];

function validateReview({
  aliases,
  canonicalName,
  decision,
  duplicateTarget,
  provenance,
  reason,
}: {
  aliases: string[];
  canonicalName: string;
  decision: ReviewDecision;
  duplicateTarget: string;
  provenance: string;
  reason: string;
}): ReviewFieldErrors {
  const errors: ReviewFieldErrors = {};
  const trimmedReason = reason.trim();
  if (!trimmedReason) {
    errors.reason = "Enter a reason for this catalog decision.";
  } else if (trimmedReason.length > 1_000) {
    errors.reason = "Decision reason must be 1,000 characters or fewer.";
  }

  if (decision === "approve") {
    const trimmedCanonical = canonicalName.trim();
    if (!trimmedCanonical) {
      errors.canonicalName = "Enter the reviewed canonical ingredient name.";
    } else if (trimmedCanonical.length > 200) {
      errors.canonicalName = "Canonical name must be 200 characters or fewer.";
    }
    const reviewedAliases = aliases.map((alias) => alias.trim()).filter(Boolean);
    if (reviewedAliases.some((alias) => alias.length > 200)) {
      errors.aliases = "Each alias must be 200 characters or fewer.";
    } else {
      const normalized = reviewedAliases.map((alias) => alias.toLocaleLowerCase());
      if (new Set(normalized).size !== normalized.length) {
        errors.aliases = "Approved aliases must be unique.";
      } else if (trimmedCanonical && normalized.includes(trimmedCanonical.toLocaleLowerCase())) {
        errors.aliases = "The canonical name cannot also be an alias.";
      }
    }
    const trimmedProvenance = provenance.trim();
    if (!trimmedProvenance) {
      errors.provenance = "Describe the source or basis for this approval.";
    } else if (trimmedProvenance.length > 1_000) {
      errors.provenance = "Provenance must be 1,000 characters or fewer.";
    }
  }

  if (decision === "duplicate" && !duplicateTarget) {
    errors.target = "Choose the existing ingredient or approved request this duplicates.";
  }
  return errors;
}

function IngredientRequestDecisionForm({
  detail,
  onAuthorizationLost,
  onRefresh,
  onReviewed,
}: ReviewDetailProps) {
  const submittingRef = useRef(false);
  const [decision, setDecision] = useState<ReviewDecision>("approve");
  const [canonicalName, setCanonicalName] = useState(detail.proposed_name);
  const [aliases, setAliases] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [provenance, setProvenance] = useState("");
  const [duplicateTarget, setDuplicateTarget] = useState("");
  const [fieldErrors, setFieldErrors] = useState<ReviewFieldErrors>({});
  const [formError, setFormError] = useState("");
  const [pending, setPending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [staleConflict, setStaleConflict] = useState(false);

  const fieldId = (name: string) => `catalog-review-${detail.id}-${name}`;

  function focusFirstInvalid(errors: ReviewFieldErrors) {
    const target = ["canonicalName", "aliases", "reason", "provenance", "target"].find(
      (field) => field in errors,
    );
    if (target) {
      window.setTimeout(() => document.getElementById(fieldId(target))?.focus(), 0);
    }
  }

  function clearError(field: keyof ReviewFieldErrors) {
    setFormError("");
    setFieldErrors((current) => {
      if (!(field in current)) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function payload(): IngredientCatalogReviewInput {
    const normalizedReason = reason.trim();
    if (decision === "approve") {
      return {
        decision,
        canonical_name: canonicalName.trim(),
        aliases: aliases.map((alias) => alias.trim()).filter(Boolean),
        reason: normalizedReason,
        provenance: provenance.trim(),
      };
    }
    if (decision === "reject") {
      return { decision, reason: normalizedReason };
    }
    const [kind, id] = duplicateTarget.split(":", 2);
    const duplicate: DuplicateIngredientCatalogRequestInput = {
      decision,
      reason: normalizedReason,
      ingredient_id: kind === "ingredient" ? id : null,
      request_id: kind === "request" ? id : null,
    };
    return duplicate;
  }

  function serverFieldErrors(error: IngredientCatalogApiError): ReviewFieldErrors {
    const errors: ReviewFieldErrors = {};
    for (const issue of error.issues) {
      const field = issue.location.at(-1);
      if (field === "canonical_name") errors.canonicalName = issue.message;
      if (field === "aliases" || typeof field === "number") errors.aliases = issue.message;
      if (field === "reason") errors.reason = issue.message;
      if (field === "provenance") errors.provenance = issue.message;
      if (field === "ingredient_id" || field === "request_id") errors.target = issue.message;
    }
    return errors;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || pending || detail.status !== "pending") {
      return;
    }
    const errors = validateReview({
      aliases,
      canonicalName,
      decision,
      duplicateTarget,
      provenance,
      reason,
    });
    setFieldErrors(errors);
    setFormError("");
    if (Object.keys(errors).length) {
      focusFirstInvalid(errors);
      return;
    }

    submittingRef.current = true;
    setPending(true);
    try {
      const updated = await reviewIngredientCatalogRequest(detail.id, payload());
      setStaleConflict(false);
      onReviewed(updated);
    } catch (reasonCaught) {
      if (reasonCaught instanceof IngredientCatalogApiError) {
        if (reasonCaught.status === 403) {
          onAuthorizationLost();
          return;
        }
        if (reasonCaught.status === 409) {
          setStaleConflict(true);
          setFormError(
            "This request or its catalog matches changed while you were reviewing it. Your entered review is still here.",
          );
        } else if (reasonCaught.status === 422) {
          const serverErrors = serverFieldErrors(reasonCaught);
          setFieldErrors(serverErrors);
          if (Object.keys(serverErrors).length) {
            focusFirstInvalid(serverErrors);
          } else {
            setFormError("Check the review fields and try again.");
          }
        } else {
          setFormError("The ingredient review could not be saved. Please try again.");
        }
      } else {
        setFormError("The ingredient review could not be saved. Please try again.");
      }
    } finally {
      submittingRef.current = false;
      setPending(false);
    }
  }

  async function refreshAfterConflict() {
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }

  if (detail.status !== "pending" && !staleConflict) {
    return <RecordedDecision detail={detail} />;
  }

  const formDisabled = pending || detail.status !== "pending";
  const approvedRequestCandidates = detail.request_candidates.filter(
    (candidate) => candidate.status === "approved" && candidate.resolved_ingredient_id,
  );
  const openRequestCandidates = detail.request_candidates.filter(
    (candidate) => candidate.status !== "approved",
  );

  return (
    <section className="curation-decision" aria-labelledby={fieldId("heading")}>
      <h3 id={fieldId("heading")}>
        {detail.status === "pending" ? "Record a decision" : "Your unsubmitted review"}
      </h3>
      {detail.status !== "pending" ? <RecordedDecision detail={detail} compact /> : null}
      {formError ? (
        <div className="curation-form-alert" role="alert">
          <p>{formError}</p>
          {staleConflict ? (
            <button
              className="button button--secondary"
              type="button"
              disabled={refreshing}
              onClick={() => void refreshAfterConflict()}
            >
              {refreshing ? "Loading current request…" : "Load current request"}
            </button>
          ) : null}
        </div>
      ) : null}

      <form className="curation-form" noValidate aria-busy={pending} onSubmit={handleSubmit}>
        <fieldset className="curation-decision-options" disabled={formDisabled}>
          <legend>Decision</legend>
          <label>
            <input
              type="radio"
              name={`decision-${detail.id}`}
              value="approve"
              checked={decision === "approve"}
              onChange={() => setDecision("approve")}
            />
            <span>
              <strong>Approve</strong>
              <small>Create one reviewed catalog identity.</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name={`decision-${detail.id}`}
              value="reject"
              checked={decision === "reject"}
              onChange={() => setDecision("reject")}
            />
            <span>
              <strong>Reject</strong>
              <small>Keep this proposed text out of the catalog.</small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name={`decision-${detail.id}`}
              value="duplicate"
              checked={decision === "duplicate"}
              onChange={() => setDecision("duplicate")}
            />
            <span>
              <strong>Duplicate</strong>
              <small>Resolve it to an existing reviewed identity.</small>
            </span>
          </label>
        </fieldset>

        {decision === "approve" ? (
          <>
            <div className="curation-field">
              <label htmlFor={fieldId("canonicalName")}>Reviewed canonical name</label>
              <input
                id={fieldId("canonicalName")}
                type="text"
                maxLength={200}
                value={canonicalName}
                disabled={formDisabled}
                aria-invalid={Boolean(fieldErrors.canonicalName)}
                aria-describedby={
                  fieldErrors.canonicalName ? fieldId("canonicalName-error") : undefined
                }
                onChange={(event) => {
                  clearError("canonicalName");
                  setCanonicalName(event.target.value);
                }}
              />
              {fieldErrors.canonicalName ? (
                <p id={fieldId("canonicalName-error")} className="curation-field-error">
                  {fieldErrors.canonicalName}
                </p>
              ) : null}
            </div>

            <fieldset className="curation-aliases" disabled={formDisabled}>
              <legend>Reviewed aliases (optional)</legend>
              <p>Aliases become searchable labels for the same canonical identity.</p>
              <span id={fieldId("aliases")} tabIndex={-1} />
              {aliases.map((alias, index) => (
                <div className="curation-alias-row" key={index}>
                  <label className="visually-hidden" htmlFor={fieldId(`alias-${index}`)}>
                    Alias {index + 1}
                  </label>
                  <input
                    id={fieldId(`alias-${index}`)}
                    type="text"
                    maxLength={200}
                    value={alias}
                    aria-invalid={Boolean(fieldErrors.aliases)}
                    onChange={(event) => {
                      clearError("aliases");
                      setAliases((current) =>
                        current.map((value, itemIndex) =>
                          itemIndex === index ? event.target.value : value,
                        ),
                      );
                    }}
                  />
                  <button
                    className="button button--quiet"
                    type="button"
                    onClick={() => setAliases((current) => current.filter((_, item) => item !== index))}
                  >
                    Remove alias {index + 1}
                  </button>
                </div>
              ))}
              {fieldErrors.aliases ? (
                <p className="curation-field-error">{fieldErrors.aliases}</p>
              ) : null}
              <button
                className="button button--quiet"
                type="button"
                disabled={formDisabled || aliases.length >= 20}
                onClick={() => setAliases((current) => [...current, ""])}
              >
                Add alias
              </button>
            </fieldset>
          </>
        ) : null}

        {decision === "duplicate" ? (
          <fieldset
            className="curation-duplicate-targets"
            disabled={formDisabled}
            aria-describedby={fieldErrors.target ? fieldId("target-error") : undefined}
          >
            <legend id={fieldId("target")} tabIndex={-1}>
              Duplicate target
            </legend>
            {detail.catalog_candidates.length === 0 &&
            approvedRequestCandidates.length === 0 ? (
              <p>No eligible duplicate targets were suggested for this request.</p>
            ) : (
              <div className="curation-target-list">
                {detail.catalog_candidates.map((candidate) => (
                  <label key={`target-ingredient-${candidate.id}`}>
                    <input
                      type="radio"
                      name={`duplicate-target-${detail.id}`}
                      value={`ingredient:${candidate.id}`}
                      checked={duplicateTarget === `ingredient:${candidate.id}`}
                      onChange={(event) => {
                        clearError("target");
                        setDuplicateTarget(event.target.value);
                      }}
                    />
                    <span>
                      <strong>{candidate.canonical_name}</strong>
                      <small>Existing catalog ingredient</small>
                    </span>
                  </label>
                ))}
                {approvedRequestCandidates.map((candidate) => (
                  <label key={`target-request-${candidate.id}`}>
                    <input
                      type="radio"
                      name={`duplicate-target-${detail.id}`}
                      value={`request:${candidate.id}`}
                      checked={duplicateTarget === `request:${candidate.id}`}
                      onChange={(event) => {
                        clearError("target");
                        setDuplicateTarget(event.target.value);
                      }}
                    />
                    <span>
                      <strong>{candidate.approved_canonical_name ?? candidate.proposed_name}</strong>
                      <small>Already approved request</small>
                    </span>
                  </label>
                ))}
              </div>
            )}
            {openRequestCandidates.length ? (
              <p>
                {openRequestCandidates.length} open or unresolved request
                {openRequestCandidates.length === 1 ? " is" : "s are"} shown above for context
                but cannot be selected as a duplicate target.
              </p>
            ) : null}
            <DuplicateTargetSearch
              detail={detail}
              disabled={formDisabled}
              inputName={`duplicate-target-${detail.id}`}
              value={duplicateTarget}
              onSelect={(target) => {
                clearError("target");
                setDuplicateTarget(target);
              }}
            />
            {fieldErrors.target ? (
              <p id={fieldId("target-error")} className="curation-field-error">
                {fieldErrors.target}
              </p>
            ) : null}
          </fieldset>
        ) : null}

        <div className="curation-field">
          <label htmlFor={fieldId("reason")}>Decision reason</label>
          <textarea
            id={fieldId("reason")}
            rows={3}
            maxLength={1_000}
            value={reason}
            disabled={formDisabled}
            aria-invalid={Boolean(fieldErrors.reason)}
            aria-describedby={fieldErrors.reason ? fieldId("reason-error") : undefined}
            onChange={(event) => {
              clearError("reason");
              setReason(event.target.value);
            }}
          />
          {fieldErrors.reason ? (
            <p id={fieldId("reason-error")} className="curation-field-error">
              {fieldErrors.reason}
            </p>
          ) : null}
        </div>

        {decision === "approve" ? (
          <div className="curation-field">
            <label htmlFor={fieldId("provenance")}>Approval provenance</label>
            <textarea
              id={fieldId("provenance")}
              rows={3}
              maxLength={1_000}
              value={provenance}
              disabled={formDisabled}
              aria-invalid={Boolean(fieldErrors.provenance)}
              aria-describedby={`${fieldId("provenance-help")}${
                fieldErrors.provenance ? ` ${fieldId("provenance-error")}` : ""
              }`}
              onChange={(event) => {
                clearError("provenance");
                setProvenance(event.target.value);
              }}
            />
            <small id={fieldId("provenance-help")}>
              Record the source or review basis that supports this catalog identity.
            </small>
            {fieldErrors.provenance ? (
              <p id={fieldId("provenance-error")} className="curation-field-error">
                {fieldErrors.provenance}
              </p>
            ) : null}
          </div>
        ) : null}

        <button
          className="button button--primary"
          type="submit"
          disabled={formDisabled}
        >
          {pending ? "Saving decision…" : `Save ${decision} decision`}
        </button>
      </form>
    </section>
  );
}

function RecordedDecision({
  compact = false,
  detail,
}: {
  compact?: boolean;
  detail: IngredientCatalogReviewDetail;
}) {
  return (
    <section
      className={`curation-recorded${compact ? " curation-recorded--compact" : ""}`}
      aria-labelledby={`recorded-decision-${detail.id}`}
    >
      <h3 id={`recorded-decision-${detail.id}`}>Recorded decision</h3>
      <dl>
        <div>
          <dt>Status</dt>
          <dd>{STATUS_LABELS[detail.status]}</dd>
        </div>
        {detail.decision_reason ? (
          <div>
            <dt>Reason</dt>
            <dd>{detail.decision_reason}</dd>
          </div>
        ) : null}
        {detail.approved_canonical_name ? (
          <div>
            <dt>Canonical name</dt>
            <dd>{detail.approved_canonical_name}</dd>
          </div>
        ) : null}
        {detail.approved_aliases?.length ? (
          <div>
            <dt>Aliases</dt>
            <dd>{detail.approved_aliases.join(", ")}</dd>
          </div>
        ) : null}
        {detail.approval_provenance ? (
          <div>
            <dt>Provenance</dt>
            <dd>{detail.approval_provenance}</dd>
          </div>
        ) : null}
        {detail.reviewed_at ? (
          <div>
            <dt>Reviewed</dt>
            <dd>
              <time dateTime={detail.reviewed_at}>{formatRequestTime(detail.reviewed_at)}</time>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
