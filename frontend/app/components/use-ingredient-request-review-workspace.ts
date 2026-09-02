"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { isAbortError } from "../../lib/abort-error";
import {
  browseIngredientCatalogReviewRequests,
  fetchIngredientCatalogReviewDetail,
  type IngredientCatalogRequestStatus,
  IngredientCatalogApiError,
  type IngredientCatalogReviewDetail,
  type IngredientCatalogReviewItem,
  type IngredientCatalogReviewPage,
} from "../../lib/ingredient-catalog-api";
import { INGREDIENT_REQUEST_STATUS_LABELS } from "../../lib/ingredient-request-presentation";

export function useIngredientRequestReviewWorkspace(
  onAuthorizationLost: () => void,
) {
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
  const detailControllerRef = useRef<AbortController | null>(null);

  const selectRequest = useCallback((requestId: string | null) => {
    if (selectedRequestIdRef.current === requestId) return;
    selectedRequestIdRef.current = requestId;
    setSelectedRequestId(requestId);
    setDetail(null);
    setDetailError("");
    setDetailLoading(requestId !== null);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void browseIngredientCatalogReviewRequests({
      status: requestStatus,
      page: pageNumber,
      pageSize: 20,
      signal: controller.signal,
    })
      .then((result) => {
        if (controller.signal.aborted) return;
        setQueue(result);
        const current = selectedRequestIdRef.current;
        const next =
          current && result.items.some((item) => item.id === current)
            ? current
            : (result.items[0]?.id ?? null);
        if (next !== current) selectRequest(next);
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason) || controller.signal.aborted) return;
        setQueue(null);
        selectRequest(null);
        if (
          reason instanceof IngredientCatalogApiError &&
          reason.status === 403
        ) {
          onAuthorizationLost();
          return;
        }
        setQueueError(
          "The ingredient review queue could not be loaded. Please try again.",
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setQueueLoading(false);
      });
    return () => controller.abort();
  }, [onAuthorizationLost, pageNumber, queueReload, requestStatus, selectRequest]);

  const runDetailRequest = useCallback(
    async (requestId: string, controller: AbortController) => {
      if (controller.signal.aborted) return;
      try {
        const result = await fetchIngredientCatalogReviewDetail(
          requestId,
          controller.signal,
        );
        if (detailControllerRef.current !== controller) return;
        setDetail(result);
        setDetailError("");
      } catch (reason) {
        if (isAbortError(reason) || detailControllerRef.current !== controller) {
          return;
        }
        if (
          reason instanceof IngredientCatalogApiError &&
          reason.status === 403
        ) {
          onAuthorizationLost();
          return;
        }
        setDetailError(
          "This ingredient request could not be loaded. Please try again.",
        );
      } finally {
        if (detailControllerRef.current === controller) {
          detailControllerRef.current = null;
          if (!controller.signal.aborted) setDetailLoading(false);
        }
      }
    },
    [onAuthorizationLost],
  );

  useEffect(() => {
    if (!selectedRequestId) {
      detailControllerRef.current?.abort();
      return;
    }
    const controller = new AbortController();
    detailControllerRef.current = controller;
    void Promise.resolve().then(() =>
      runDetailRequest(selectedRequestId, controller),
    );
    return () => detailControllerRef.current?.abort();
  }, [runDetailRequest, selectedRequestId]);

  const reloadQueue = useCallback(() => {
    setQueueLoading(true);
    setQueueError("");
    setQueueReload((value) => value + 1);
  }, []);

  const changePage = useCallback((nextPage: number) => {
    setQueueLoading(true);
    setQueueError("");
    setPageNumber(nextPage);
  }, []);

  const changeStatus = useCallback(
    (nextStatus: IngredientCatalogRequestStatus) => {
      if (nextStatus === requestStatus) return;
      setRequestStatus(nextStatus);
      setPageNumber(1);
      setQueueLoading(true);
      setQueueError("");
      setQueue(null);
      selectRequest(null);
      setWorkspaceStatus("");
    },
    [requestStatus, selectRequest],
  );

  const refreshDetail = useCallback(async () => {
    if (!selectedRequestId) return;
    detailControllerRef.current?.abort();
    const controller = new AbortController();
    detailControllerRef.current = controller;
    setDetailLoading(true);
    await runDetailRequest(selectedRequestId, controller);
  }, [runDetailRequest, selectedRequestId]);

  const recordReviewed = useCallback(
    (updated: IngredientCatalogReviewItem) => {
      setWorkspaceStatus(
        `${updated.proposed_name} is now ${INGREDIENT_REQUEST_STATUS_LABELS[
          updated.status
        ].toLocaleLowerCase()}.`,
      );
      setDetail((current) =>
        current?.id === updated.id ? { ...current, ...updated } : current,
      );
      reloadQueue();
    },
    [reloadQueue],
  );

  return {
    changePage,
    changeStatus,
    detail,
    detailError,
    detailLoading,
    queue,
    queueError,
    queueIsEmpty: Boolean(
      queue && !queueLoading && !queueError && queue.total === 0,
    ),
    queueLoading,
    recordReviewed,
    refreshDetail,
    reloadQueue,
    requestStatus,
    selectedRequestId,
    selectRequest,
    workspaceStatus,
  };
}
