import { useEffect, useRef, useState } from "react";

import {
  browseMyIngredientRequests,
  type IngredientCatalogRequestStatus,
  IngredientCatalogApiError,
  type MemberIngredientRequestPage,
} from "../../lib/ingredient-catalog-api";

export interface MemberIngredientRequestHistoryState {
  authenticationExpired: boolean;
  loadError: string;
  loading: boolean;
  query: string;
  queryInput: string;
  requestPage: MemberIngredientRequestPage | null;
  statusFilter: IngredientCatalogRequestStatus | "";
  changePage: (page: number) => void;
  changeStatusFilter: (status: IngredientCatalogRequestStatus | "") => void;
  expireAuthentication: () => void;
  refresh: () => void;
  restoreAuthentication: () => void;
  submitSearch: () => void;
  updateQueryInput: (value: string) => void;
}

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

export function useMemberIngredientRequestHistory({
  pageSize,
  selectionEnabled,
}: {
  pageSize: number;
  selectionEnabled: boolean;
}): MemberIngredientRequestHistoryState {
  const listSequenceRef = useRef(0);
  const [statusFilter, setStatusFilter] = useState<IngredientCatalogRequestStatus | "">("");
  const [queryInput, setQueryInput] = useState("");
  const [query, setQuery] = useState("");
  const [pageNumber, setPageNumber] = useState(1);
  const [requestPage, setRequestPage] = useState<MemberIngredientRequestPage | null>(null);
  const [loadError, setLoadError] = useState("");
  const [authenticationExpired, setAuthenticationExpired] = useState(false);
  const [reload, setReload] = useState(0);
  const listRequestKey = `${statusFilter}\u0000${query}\u0000${pageNumber}\u0000${pageSize}\u0000${reload}`;
  const [settledListRequestKey, setSettledListRequestKey] = useState<string | null>(null);
  const loading = settledListRequestKey !== listRequestKey;

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

  function submitSearch() {
    const nextQuery = queryInput.trim();
    setLoadError("");
    setPageNumber(1);
    if (nextQuery === query && pageNumber === 1) {
      setReload((current) => current + 1);
    } else {
      setQuery(nextQuery);
    }
  }

  function changeStatusFilter(status: IngredientCatalogRequestStatus | "") {
    setLoadError("");
    setStatusFilter(status);
    setPageNumber(1);
  }

  function changePage(nextPage: number) {
    setLoadError("");
    setPageNumber(nextPage);
  }

  function refresh() {
    setLoadError("");
    setReload((current) => current + 1);
  }

  return {
    authenticationExpired,
    changePage,
    changeStatusFilter,
    expireAuthentication: () => setAuthenticationExpired(true),
    loadError,
    loading,
    query,
    queryInput,
    refresh,
    requestPage,
    restoreAuthentication: () => setAuthenticationExpired(false),
    statusFilter,
    submitSearch,
    updateQueryInput: setQueryInput,
  };
}
