"use client";

import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  browseMyIngredientRequests,
  type CatalogIngredientSelection,
  fetchMyIngredientRequest,
  type IngredientCatalogRequestStatus,
  IngredientCatalogApiError,
  type MemberIngredientRequest,
  type MemberIngredientRequestPage,
} from "../../lib/ingredient-catalog-api";

const STATUS_LABELS: Record<IngredientCatalogRequestStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  duplicate: "Duplicate",
};

interface MemberIngredientRequestHistoryProps {
  contextLabel?: string;
  idPrefix: string;
  onClose?: () => void;
  onSelectResolution?: (selection: CatalogIngredientSelection) => void;
  pageSize?: number;
}

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

function requestGuidance(request: MemberIngredientRequest): string {
  if (request.status === "pending") {
    return "Waiting for curator review. The proposed text is not a catalog ingredient.";
  }
  if (request.status === "rejected") {
    return "This request was not added to the catalog and cannot be selected in a recipe.";
  }
  if (request.status === "duplicate") {
    return "A curator matched this request to an ingredient that is already in the catalog.";
  }
  return "A curator added this ingredient to the catalog.";
}

export function MemberIngredientRequestHistory({
  contextLabel,
  idPrefix,
  onClose,
  onSelectResolution,
  pageSize = 20,
}: MemberIngredientRequestHistoryProps) {
  const listSequenceRef = useRef(0);
  const selectionControllerRef = useRef<AbortController | null>(null);
  const selectionPendingRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState<IngredientCatalogRequestStatus | "">("");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [requestPage, setRequestPage] = useState<MemberIngredientRequestPage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selectionError, setSelectionError] = useState("");
  const [authenticationExpired, setAuthenticationExpired] = useState(false);
  const [selectingRequestId, setSelectingRequestId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const listRequestKey = `${statusFilter}\u0000${query}\u0000${pageNumber}\u0000${pageSize}\u0000${reload}`;
  const [settledListRequestKey, setSettledListRequestKey] = useState<string | null>(null);
  const loading = settledListRequestKey !== listRequestKey;

  const selectionEnabled = Boolean(contextLabel && onSelectResolution);
  const regionLabel = selectionEnabled
    ? `Choose from my ingredient requests for ${contextLabel}`
    : "My ingredient requests";
  const searchLabel = selectionEnabled
    ? `Search my ingredient requests for ${contextLabel}`
    : "Search my ingredient requests";
  const filterLabel = selectionEnabled
    ? `Request status for ${contextLabel}`
    : "Request status";

  useEffect(() => {
    const sequence = listSequenceRef.current + 1;
    listSequenceRef.current = sequence;
    const controller = new AbortController();

    void browseMyIngredientRequests({
      status: statusFilter || undefined,
      page: pageNumber,
      pageSize,
      query,
      signal: controller.signal,
    })
      .then((result) => {
        if (!controller.signal.aborted && sequence === listSequenceRef.current) {
          setRequestPage(result);
          setLoadError("");
          setAuthenticationExpired(false);
        }
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason) || sequence !== listSequenceRef.current) {
          return;
        }
        setRequestPage(null);
        if (reason instanceof IngredientCatalogApiError && reason.status === 401) {
          setAuthenticationExpired(true);
        }
        setLoadError(
          reason instanceof IngredientCatalogApiError && reason.status === 401
            ? selectionEnabled
              ? "Your session expired. Your recipe was not changed. Sign in again in another tab, then retry."
              : "Your session expired. Sign in again, then retry your request history."
            : reason instanceof IngredientCatalogApiError
              ? reason.message
              : "Your ingredient requests could not be loaded. Please try again.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted && sequence === listSequenceRef.current) {
          setSettledListRequestKey(listRequestKey);
        }
      });

    return () => controller.abort();
  }, [listRequestKey, pageNumber, pageSize, query, selectionEnabled, statusFilter]);

  useEffect(
    () => () => {
      selectionControllerRef.current?.abort();
    },
    [],
  );

  function submitSearch() {
    const nextQuery = queryInput.trim();
    setLoadError("");
    setPageNumber(1);
    setSelectionError("");
    if (nextQuery === query && pageNumber === 1) {
      setReload((current) => current + 1);
    } else {
      setQuery(nextQuery);
    }
  }

  async function selectResolution(request: MemberIngredientRequest) {
    if (
      selectionPendingRef.current ||
      !selectionEnabled ||
      !onSelectResolution ||
      !request.resolved_ingredient
    ) {
      return;
    }

    selectionPendingRef.current = true;
    selectionControllerRef.current?.abort();
    const controller = new AbortController();
    selectionControllerRef.current = controller;
    setSelectingRequestId(request.id);
    setSelectionError("");

    try {
      const current = await fetchMyIngredientRequest(request.id, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      const resolved = current.resolved_ingredient;
      if (
        current.id !== request.id ||
        (current.status !== "approved" && current.status !== "duplicate") ||
        resolved === null ||
        resolved.id !== request.resolved_ingredient.id
      ) {
        setSelectionError(
          "This request changed since it was loaded. Your recipe was not changed. Refresh your requests before choosing it.",
        );
        return;
      }

      setAuthenticationExpired(false);
      onSelectResolution({
        ingredientId: resolved.id,
        canonicalName: resolved.canonical_name,
        displayName: resolved.canonical_name,
      });
    } catch (reason) {
      if (!isAbortError(reason)) {
        if (reason instanceof IngredientCatalogApiError && reason.status === 401) {
          setAuthenticationExpired(true);
        }
        setSelectionError(
          reason instanceof IngredientCatalogApiError && reason.status === 401
            ? "Your session expired. Your recipe was not changed. Sign in again in another tab, then retry."
            : "We couldn’t confirm this catalog resolution. Your recipe was not changed. Try again.",
        );
      }
    } finally {
      selectionPendingRef.current = false;
      if (!controller.signal.aborted) {
        setSelectingRequestId(null);
      }
    }
  }

  return (
    <section
      className={`member-request-history${selectionEnabled ? " member-request-history--picker" : ""}`}
      aria-label={regionLabel}
      aria-busy={loading}
    >
      <header className="member-request-history__header">
        <div>
          {selectionEnabled ? <h3>{regionLabel}</h3> : <h2>Request history</h2>}
          <p>
            Track what happened to your requests. Only a curator-approved catalog resolution can
            be chosen for a recipe.
          </p>
        </div>
        {onClose ? (
          <button
            className="button button--quiet"
            type="button"
            disabled={selectingRequestId !== null}
            onClick={onClose}
          >
            Close my requests
          </button>
        ) : null}
      </header>

      <div className="member-request-history__controls">
        <div className="member-request-history__filter">
          <label htmlFor={`${idPrefix}-status-filter`}>{filterLabel}</label>
          <select
            id={`${idPrefix}-status-filter`}
            value={statusFilter}
            onChange={(event) => {
              setLoadError("");
              setSelectionError("");
              setStatusFilter(event.target.value as IngredientCatalogRequestStatus | "");
              setPageNumber(1);
            }}
          >
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="duplicate">Duplicate</option>
          </select>
        </div>
        <div
          className="member-request-history__search"
          role="search"
          aria-label={searchLabel}
        >
          <label htmlFor={`${idPrefix}-request-search`}>{searchLabel}</label>
          <div>
            <input
              id={`${idPrefix}-request-search`}
              type="search"
              maxLength={100}
              autoComplete="off"
              value={queryInput}
              onChange={(event) => setQueryInput(event.target.value)}
              onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submitSearch();
                }
              }}
            />
            <button
              className="button button--secondary"
              type="button"
              onClick={submitSearch}
            >
              Search requests
            </button>
          </div>
        </div>
      </div>

      {loadError ? (
        <div className="member-request-history__error" role="alert">
          <p>{loadError}</p>
          <button
            className="button button--secondary"
            type="button"
            onClick={() => {
              setLoadError("");
              setSelectionError("");
              setReload((current) => current + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : null}

      {selectionError ? (
        <p className="member-request-history__selection-error" role="alert">
          {selectionError}
        </p>
      ) : null}

      {authenticationExpired ? (
        <div className="member-request-history__auth-recovery">
          <a
            className="button button--secondary"
            href="/sign-in?return_to=%2Frecipes"
            target="_blank"
            rel="noreferrer"
          >
            Sign in in a new tab
          </a>
          <p>
            {selectionEnabled
              ? "Keep this recipe tab open. After signing in, return here and retry without losing your draft."
              : "After signing in, return to this tab and try loading your requests again."}
          </p>
        </div>
      ) : null}

      {loading && requestPage === null ? (
        <div className="member-request-history__state" role="status" aria-live="polite">
          Loading your ingredient requests…
        </div>
      ) : null}

      {!loading && !loadError && requestPage?.items.length === 0 ? (
        <div className="member-request-history__state">
          <h3>No matching requests</h3>
          <p>
            {query || statusFilter
              ? "Try a different search or status filter."
              : "Requests you submit from an ingredient picker will appear here."}
          </p>
        </div>
      ) : null}

      {requestPage && requestPage.items.length > 0 ? (
        <>
          <p className="member-request-history__summary" role="status" aria-live="polite">
            {requestPage.total} request{requestPage.total === 1 ? "" : "s"}. Page{" "}
            {requestPage.page} of {requestPage.total_pages}.
          </p>
          <div className="member-request-history__list">
            {requestPage.items.map((request) => {
              const resolved = request.resolved_ingredient;
              const selectable =
                selectionEnabled &&
                resolved !== null &&
                (request.status === "approved" || request.status === "duplicate");
              return (
                <article
                  key={request.id}
                  className="member-request-card"
                  aria-label={`Ingredient request: ${request.proposed_name}`}
                >
                  <header className="member-request-card__header">
                    <h3>{request.proposed_name}</h3>
                    <span className={`curation-status curation-status--${request.status}`}>
                      {STATUS_LABELS[request.status]}
                    </span>
                  </header>
                  <dl className="member-request-card__facts">
                    <div>
                      <dt>Status</dt>
                      <dd>{STATUS_LABELS[request.status]}</dd>
                    </div>
                    <div>
                      <dt>Requested</dt>
                      <dd>
                        <time dateTime={request.created_at}>
                          {formatRequestTime(request.created_at)}
                        </time>
                      </dd>
                    </div>
                    {request.reviewed_at ? (
                      <div>
                        <dt>Reviewed</dt>
                        <dd>
                          <time dateTime={request.reviewed_at}>
                            {formatRequestTime(request.reviewed_at)}
                          </time>
                        </dd>
                      </div>
                    ) : null}
                    {request.context ? (
                      <div className="member-request-card__wide">
                        <dt>Context</dt>
                        <dd>{request.context}</dd>
                      </div>
                    ) : null}
                    {request.decision_reason ? (
                      <div className="member-request-card__wide">
                        <dt>Decision reason</dt>
                        <dd>{request.decision_reason}</dd>
                      </div>
                    ) : null}
                    {resolved ? (
                      <div className="member-request-card__wide">
                        <dt>Resolved ingredient</dt>
                        <dd>
                          <strong>{resolved.canonical_name}</strong>
                          {resolved.aliases.length > 0 ? (
                            <small>Also known as: {resolved.aliases.join(", ")}</small>
                          ) : null}
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                  <p className="member-request-card__guidance">{requestGuidance(request)}</p>
                  {selectable && resolved && contextLabel ? (
                    <button
                      className="button button--secondary"
                      type="button"
                      disabled={loading || selectingRequestId !== null}
                      onClick={() => void selectResolution(request)}
                    >
                      {selectingRequestId === request.id
                        ? `Confirming ${resolved.canonical_name}…`
                        : `Use ${resolved.canonical_name} for ${contextLabel}`}
                    </button>
                  ) : resolved ? (
                    <p className="member-request-card__availability">
                      This catalog resolution is available from an ingredient picker while you
                      edit a recipe.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>

          {requestPage.total_pages > 1 ? (
            <nav className="member-request-history__pagination" aria-label={`${regionLabel} pages`}>
              <button
                className="button button--quiet"
                type="button"
                disabled={requestPage.page <= 1}
                onClick={() => {
                  setLoadError("");
                  setSelectionError("");
                  setPageNumber(requestPage.page - 1);
                }}
              >
                ← Previous
              </button>
              <span aria-current="page">
                Page {requestPage.page} of {requestPage.total_pages}
              </span>
              <button
                className="button button--quiet"
                type="button"
                disabled={requestPage.page >= requestPage.total_pages}
                onClick={() => {
                  setLoadError("");
                  setSelectionError("");
                  setPageNumber(requestPage.page + 1);
                }}
              >
                Next →
              </button>
            </nav>
          ) : null}
        </>
      ) : null}

      <button
        className="button button--quiet member-request-history__refresh"
        type="button"
        onClick={() => {
          setLoadError("");
          setSelectionError("");
          setReload((current) => current + 1);
        }}
      >
        Refresh my requests
      </button>
    </section>
  );
}
