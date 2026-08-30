"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  browseIngredientCatalogReviewRequests,
  fetchIngredientCatalogReviewDetail,
  type IngredientCatalogRequestStatus,
  IngredientCatalogApiError,
  type IngredientCatalogReviewDetail,
  type IngredientCatalogReviewItem,
  type IngredientCatalogReviewPage,
} from "../../lib/ingredient-catalog-api";
import { useAuthSession } from "./auth-session-provider";
import { IngredientRequestReviewDetail } from "./ingredient-request-review-detail";
import { isAbortError, STATUS_LABELS } from "./ingredient-request-review-model";
import {
  IngredientRequestReviewQueue,
  IngredientRequestStatusFilters,
} from "./ingredient-request-review-queue";

function unavailablePage() {
  return (
    <main
      id="main-content"
      className="state-page staff-state-page staff-state-page--curation staff-state-page--authorization"
    >
      <div className="error-state staff-state-panel" role="alert">
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
      <main
        id="main-content"
        className="state-page staff-state-page staff-state-page--curation staff-state-page--loading"
      >
        <div
          className="loading-state staff-state-panel"
          role="status"
          aria-live="polite"
        >
          <span className="loading-state__pulse" aria-hidden="true" />
          <strong>Checking review access…</strong>
          <span>Loading your account permissions.</span>
        </div>
      </main>
    );
  }

  if (state.phase === "error") {
    return (
      <main
        id="main-content"
        className="state-page staff-state-page staff-state-page--curation staff-state-page--error"
      >
        <div className="error-state staff-state-panel" role="alert">
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
    if (selectedRequestIdRef.current === requestId) {
      return;
    }
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
    <main
      id="main-content"
      className="page-shell staff-workspace staff-workspace--curation curation-page"
    >
      <header className="page-intro staff-workspace__header curation-page__intro">
        <p className="eyebrow">Catalog curation</p>
        <h1>Review ingredient requests.</h1>
        <p>
          Make one accountable decision for each request. Candidate matches are suggestions only;
          they never establish ingredient identity automatically.
        </p>
      </header>

      <IngredientRequestStatusFilters
        requestStatus={requestStatus}
        onChangeStatus={changeStatus}
      />

      {workspaceStatus ? (
        <div
          ref={workspaceStatusRef}
          className="staff-workspace__notice staff-workspace__notice--success curation-success-summary"
          role="status"
          aria-live="polite"
          tabIndex={-1}
        >
          <strong>Decision saved.</strong>
          <span>{workspaceStatus}</span>
        </div>
      ) : null}

      <div className="staff-workspace__layout curation-workspace">
        <IngredientRequestReviewQueue
          queue={queue}
          queueError={queueError}
          queueLoading={queueLoading}
          requestStatus={requestStatus}
          selectedRequestId={selectedRequestId}
          onChangePage={changePage}
          onReloadQueue={reloadQueue}
          onSelectRequest={selectRequest}
        />

        <section
          className="staff-panel-surface staff-workspace__detail curation-detail"
          aria-labelledby="curation-detail-heading"
        >
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
            <div
              className="staff-workspace__notice staff-workspace__notice--error curation-panel-state"
              role="alert"
            >
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
