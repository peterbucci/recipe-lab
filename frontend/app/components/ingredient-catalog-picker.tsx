"use client";

import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  browseMyIngredientRequests,
  type CatalogIngredient,
  type CatalogIngredientPage,
  type CatalogIngredientSelection,
  type IngredientCatalogRequestStatus,
  type MemberIngredientRequest,
  type MissingIngredientRequest,
  searchCatalogIngredients,
  selectionForCatalogIngredient,
} from "../../lib/ingredient-catalog-api";
import { retryTransientRead } from "../../lib/api-transport/transient-read-retry";
import { InlineLoading, LoadingButton } from "./loading-ui";
import { MissingIngredientRequestPanel } from "./missing-ingredient-request-panel";

interface IngredientRequestValue {
  id: string;
  proposed_name: string;
  status: IngredientCatalogRequestStatus;
  resolved_ingredient: CatalogIngredient | null;
}

interface IngredientCatalogPickerProps {
  contextLabel: string;
  describedBy?: string;
  disabled?: boolean;
  idPrefix: string;
  inputClassName?: string;
  invalid?: boolean;
  label: string;
  onChange: (selection: CatalogIngredientSelection | null) => void;
  onRequestSubmitted?: (request: MissingIngredientRequest) => void;
  requestValue?: IngredientRequestValue | null;
  value: CatalogIngredientSelection | null;
}

interface ApprovedIngredientOption {
  ingredient: CatalogIngredient;
  key: string;
  requestResolution: boolean;
  selection: CatalogIngredientSelection;
}

interface PendingRequestSuggestion {
  id: string;
  proposedName: string;
}

type IngredientSearchResource = "catalog" | "requests";

const SEARCH_DELAY_MS = 200;
const MINIMUM_QUERY_LENGTH = 2;

function isAbortError(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "name" in reason &&
    reason.name === "AbortError"
  );
}

function authenticationSearchMessage(
  reason: unknown,
  resource: IngredientSearchResource,
): string {
  if (typeof reason !== "object" || reason === null) return "";

  const status = "status" in reason ? reason.status : undefined;
  const code = "code" in reason ? reason.code : undefined;
  if (status === 401 || code === "authentication_required") {
    return resource === "requests"
      ? "Your session expired. Sign in again to check pending ingredient requests."
      : "Your session expired. Sign in again to search ingredients.";
  }
  if (code === "account_setup_required") {
    return "Finish setting up your account to check pending ingredient requests.";
  }
  return "";
}

function searchFailureMessage(
  failedResources: IngredientSearchResource[],
): string {
  if (failedResources.length > 1) {
    return "Ingredient suggestions couldn’t be loaded.";
  }
  return failedResources[0] === "catalog"
    ? "The ingredient catalog couldn’t be searched."
    : "Pending ingredient requests couldn’t be checked.";
}

function requestStateLabel(request: IngredientRequestValue): string {
  if (request.status === "pending") return "Pending review";
  if (request.status === "rejected") return "Not approved";
  return request.resolved_ingredient
    ? "Approved — choose the catalog match"
    : "Approved";
}

export function IngredientCatalogPicker({
  contextLabel,
  describedBy,
  disabled = false,
  idPrefix,
  inputClassName,
  invalid = false,
  label,
  onChange,
  onRequestSubmitted,
  requestValue = null,
  value,
}: IngredientCatalogPickerProps) {
  const inputFocusedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const popupRef = useRef<HTMLDivElement>(null);
  const disabledRef = useRef(disabled);
  const searchControllerRef = useRef<AbortController | null>(null);
  const searchSequenceRef = useRef(0);
  const resultPageRef = useRef<CatalogIngredientPage | null>(null);
  const pendingRequestsRef = useRef<MemberIngredientRequest[]>([]);
  const pendingRequestTotalRef = useRef(0);
  const selectionDisplayName =
    value?.displayName ?? requestValue?.proposed_name ?? "";
  const selectionKey = value
    ? `catalog:${value.ingredientId}:${value.canonicalName}:${value.displayName}`
    : requestValue
      ? `request:${requestValue.id}:${requestValue.status}:${requestValue.proposed_name}:${requestValue.resolved_ingredient?.id ?? ""}`
      : "";
  const [query, setQuery] = useState(selectionDisplayName);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [resultPage, setResultPage] = useState<CatalogIngredientPage | null>(
    null,
  );
  const [pendingRequests, setPendingRequests] = useState<
    MemberIngredientRequest[]
  >([]);
  const [failedSearchResources, setFailedSearchResources] = useState<
    IngredientSearchResource[]
  >([]);
  const [authenticationSearchError, setAuthenticationSearchError] =
    useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [requestOpen, setRequestOpen] = useState(false);
  const [searchRetryRevision, setSearchRetryRevision] = useState(0);
  const [syncedSelectionKey, setSyncedSelectionKey] = useState(selectionKey);
  const [syncedDisabled, setSyncedDisabled] = useState(disabled);

  if (selectionKey !== syncedSelectionKey) {
    setSyncedSelectionKey(selectionKey);
    setQuery(selectionDisplayName);
    setSearchActive(false);
    setSearching(false);
    setResultPage(null);
    setPendingRequests([]);
    setFailedSearchResources([]);
    setAuthenticationSearchError("");
    setPopupOpen(false);
    setActiveIndex(-1);
    setHasSearched(false);
  }

  if (disabled !== syncedDisabled) {
    setSyncedDisabled(disabled);
    if (disabled) {
      setSearching(false);
      setSearchActive(false);
      setResultPage(null);
      setPendingRequests([]);
      setFailedSearchResources([]);
      setAuthenticationSearchError("");
      setPopupOpen(false);
      setActiveIndex(-1);
      setHasSearched(false);
      setRequestOpen(false);
    }
  }

  useEffect(
    () => () => {
      searchControllerRef.current?.abort();
    },
    [],
  );

  useLayoutEffect(() => {
    disabledRef.current = disabled;
  }, [disabled]);

  useLayoutEffect(() => {
    resultPageRef.current = null;
    pendingRequestsRef.current = [];
    pendingRequestTotalRef.current = 0;
  }, [disabled, selectionKey]);

  useEffect(() => {
    searchControllerRef.current?.abort();
    searchSequenceRef.current += 1;
  }, [selectionKey]);

  useEffect(() => {
    if (!disabled) return;
    searchControllerRef.current?.abort();
    searchSequenceRef.current += 1;
  }, [disabled]);

  const resolvedRequestIngredient = requestValue?.resolved_ingredient ?? null;
  const approvedOptions: ApprovedIngredientOption[] = [];
  if (resolvedRequestIngredient) {
    approvedOptions.push({
      ingredient: resolvedRequestIngredient,
      key: `request-resolution:${resolvedRequestIngredient.id}`,
      requestResolution: true,
      selection: {
        ingredientId: resolvedRequestIngredient.id,
        canonicalName: resolvedRequestIngredient.canonical_name,
        displayName: resolvedRequestIngredient.canonical_name,
      },
    });
  }
  for (const ingredient of resultPage?.items ?? []) {
    if (ingredient.id === resolvedRequestIngredient?.id) continue;
    approvedOptions.push({
      ingredient,
      key: `catalog:${ingredient.id}`,
      requestResolution: false,
      selection: selectionForCatalogIngredient(ingredient, searchedQuery),
    });
  }

  const pendingSuggestionMap = new Map<string, PendingRequestSuggestion>();
  if (requestValue?.status === "pending") {
    pendingSuggestionMap.set(requestValue.id, {
      id: requestValue.id,
      proposedName: requestValue.proposed_name,
    });
  }
  for (const request of pendingRequests) {
    pendingSuggestionMap.set(request.id, {
      id: request.id,
      proposedName: request.proposed_name,
    });
  }
  const pendingSuggestions = Array.from(pendingSuggestionMap.values());

  useEffect(() => {
    if (!popupOpen || activeIndex < 0) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, popupOpen]);

  useEffect(() => {
    const normalizedQuery = query.trim();
    if (
      disabled ||
      !searchActive ||
      normalizedQuery.length < MINIMUM_QUERY_LENGTH
    ) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const sequence = searchSequenceRef.current + 1;
      searchSequenceRef.current = sequence;
      searchControllerRef.current?.abort();
      const controller = new AbortController();
      searchControllerRef.current = controller;
      setSearching(true);
      setFailedSearchResources([]);
      setAuthenticationSearchError("");
      setSearchStatus("Searching ingredients…");
      setSearchedQuery(normalizedQuery);
      setHasSearched(false);
      setActiveIndex(-1);

      const catalogLookup = searchCatalogIngredients({
        query: normalizedQuery,
        page: 1,
        pageSize: 8,
        signal: controller.signal,
      });
      const requestLookup = retryTransientRead(
        (signal) =>
          browseMyIngredientRequests({
            status: "pending",
            query: normalizedQuery,
            page: 1,
            pageSize: 8,
            signal,
          }),
        { signal: controller.signal },
      );

      void Promise.allSettled([catalogLookup, requestLookup] as const)
        .then(([catalogResult, requestResult]) => {
          if (sequence !== searchSequenceRef.current || disabledRef.current)
            return;

          if (catalogResult.status === "fulfilled") {
            resultPageRef.current = catalogResult.value;
            setResultPage(catalogResult.value);
            setHasSearched(true);
          }
          if (requestResult.status === "fulfilled") {
            pendingRequestsRef.current = requestResult.value.items;
            pendingRequestTotalRef.current = requestResult.value.total;
            setPendingRequests(requestResult.value.items);
          }
          setPopupOpen(inputFocusedRef.current);

          const failedResources: IngredientSearchResource[] = [];
          let authenticationError = "";
          if (
            catalogResult.status === "rejected" &&
            !isAbortError(catalogResult.reason)
          ) {
            authenticationError = authenticationSearchMessage(
              catalogResult.reason,
              "catalog",
            );
            if (!authenticationError) failedResources.push("catalog");
          }
          if (
            requestResult.status === "rejected" &&
            !isAbortError(requestResult.reason)
          ) {
            const requestAuthenticationError = authenticationSearchMessage(
              requestResult.reason,
              "requests",
            );
            authenticationError ||= requestAuthenticationError;
            if (!requestAuthenticationError) failedResources.push("requests");
          }
          setFailedSearchResources(failedResources);
          setAuthenticationSearchError(authenticationError);

          const approvedCount = resultPageRef.current?.total ?? 0;
          const pendingCount = pendingRequestTotalRef.current;
          if (
            catalogResult.status === "fulfilled" &&
            requestResult.status === "fulfilled" &&
            approvedCount === 0 &&
            pendingCount === 0
          ) {
            setSearchStatus(`No ingredients match ${normalizedQuery}.`);
          } else if (approvedCount > 0 || pendingCount > 0) {
            const parts = [];
            if (approvedCount > 0) {
              parts.push(
                `${approvedCount} approved ingredient${approvedCount === 1 ? "" : "s"}`,
              );
            }
            if (pendingCount > 0) {
              parts.push(
                `${pendingCount} pending request${pendingCount === 1 ? "" : "s"}`,
              );
            }
            setSearchStatus(`${parts.join(" and ")} found.`);
          } else if (failedResources.length > 0 || authenticationError) {
            setSearchStatus("Some ingredient suggestions are unavailable.");
          }
        })
        .finally(() => {
          if (sequence === searchSequenceRef.current && !disabledRef.current) {
            setSearching(false);
          }
        });
    }, SEARCH_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [disabled, query, searchActive, searchRetryRevision]);

  function invalidateSearch() {
    searchControllerRef.current?.abort();
    searchSequenceRef.current += 1;
    setSearching(false);
    setResultPage(null);
    resultPageRef.current = null;
    setPendingRequests([]);
    pendingRequestsRef.current = [];
    pendingRequestTotalRef.current = 0;
    setFailedSearchResources([]);
    setAuthenticationSearchError("");
    setPopupOpen(false);
    setActiveIndex(-1);
  }

  function selectCatalogIngredient(selection: CatalogIngredientSelection) {
    if (disabled) return;
    invalidateSearch();
    setSearchActive(false);
    setHasSearched(false);
    setQuery(selection.displayName);
    setSearchedQuery("");
    setRequestOpen(false);
    setSearchStatus(`${selection.displayName} selected for ${contextLabel}.`);
    onChange(selection);
    inputRef.current?.focus();
  }

  function handleComboboxKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && approvedOptions.length > 0) {
      event.preventDefault();
      setPopupOpen(true);
      setActiveIndex((current) =>
        current < approvedOptions.length - 1 ? current + 1 : 0,
      );
      return;
    }
    if (event.key === "ArrowUp" && approvedOptions.length > 0) {
      event.preventDefault();
      setPopupOpen(true);
      setActiveIndex((current) =>
        current > 0 ? current - 1 : approvedOptions.length - 1,
      );
      return;
    }
    if (event.key === "Enter") {
      if (popupOpen && activeIndex >= 0) {
        event.preventDefault();
        const option = approvedOptions[activeIndex];
        if (option) selectCatalogIngredient(option.selection);
      }
      return;
    }
    if (
      event.key === "Escape" &&
      (searchActive || searching || popupOpen || resultPage)
    ) {
      event.preventDefault();
      invalidateSearch();
      setSearchActive(false);
      setHasSearched(false);
      setSearchStatus("Ingredient suggestions closed.");
      if (document.activeElement !== inputRef.current)
        inputRef.current?.focus();
    }
  }

  function closeRequest() {
    setRequestOpen(false);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleInputBlur(event: FocusEvent<HTMLInputElement>) {
    inputFocusedRef.current = false;
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && popupRef.current?.contains(nextTarget)) {
      return;
    }
    setPopupOpen(false);
  }

  const helpId = `${idPrefix}-search-help`;
  const statusId = `${idPrefix}-search-status`;
  const listboxId = `${idPrefix}-suggestions`;
  const activeOptionId =
    popupOpen && activeIndex >= 0
      ? `${idPrefix}-option-${activeIndex}`
      : undefined;
  const inputDescription = [helpId, statusId, describedBy]
    .filter(Boolean)
    .join(" ");
  const requestState = requestValue ? requestStateLabel(requestValue) : "";

  return (
    <div className="ingredient-picker">
      <label htmlFor={`${idPrefix}-search`}>{label}</label>
      <small id={helpId} className="visually-hidden">
        Search approved ingredients. Pending requests are shown but cannot be
        used until approved.
      </small>

      <div className="ingredient-picker__combobox">
        <input
          ref={inputRef}
          id={`${idPrefix}-search`}
          className={inputClassName || undefined}
          type="text"
          role="combobox"
          autoComplete="off"
          maxLength={100}
          value={query}
          disabled={disabled}
          aria-autocomplete="list"
          aria-expanded={popupOpen}
          aria-controls={listboxId}
          aria-activedescendant={activeOptionId}
          aria-busy={searching}
          aria-invalid={invalid}
          aria-describedby={inputDescription}
          placeholder="Type an ingredient"
          onBlur={handleInputBlur}
          onFocus={() => {
            if (disabled) return;
            inputFocusedRef.current = true;
            setPopupOpen(true);
            setSearchActive(true);
          }}
          onChange={(event) => {
            const nextQuery = event.target.value;
            invalidateSearch();
            if ((value || requestValue) && nextQuery !== selectionDisplayName) {
              setSyncedSelectionKey("");
              onChange(null);
            }
            setQuery(nextQuery);
            setSearchActive(true);
            setPopupOpen(true);
            setFailedSearchResources([]);
            setAuthenticationSearchError("");
            setSearchStatus(
              nextQuery.trim().length > 0 &&
                nextQuery.trim().length < MINIMUM_QUERY_LENGTH
                ? `Type at least ${MINIMUM_QUERY_LENGTH} characters to search.`
                : "",
            );
            setHasSearched(false);
          }}
          onKeyDown={handleComboboxKeyDown}
        />
        {popupOpen ? (
          <div
            ref={popupRef}
            className="ingredient-picker__popup"
            onMouseDown={(event) => event.preventDefault()}
          >
            <ul
              id={listboxId}
              className="ingredient-picker__results"
              role="listbox"
              aria-label={`${label} suggestions`}
            >
              {approvedOptions.map((option, index) => {
                const selected =
                  value?.ingredientId === option.selection.ingredientId &&
                  value.displayName === option.selection.displayName;
                return (
                  <li
                    ref={(node) => {
                      optionRefs.current[index] = node;
                    }}
                    id={`${idPrefix}-option-${index}`}
                    key={option.key}
                    role="option"
                    tabIndex={-1}
                    aria-selected={selected}
                    aria-disabled={disabled}
                    className={index === activeIndex ? "is-active" : undefined}
                    onKeyDown={(event) => {
                      if (
                        !disabled &&
                        (event.key === "Enter" || event.key === " ")
                      ) {
                        event.preventDefault();
                        selectCatalogIngredient(option.selection);
                      }
                    }}
                    onClick={() => {
                      if (!disabled) selectCatalogIngredient(option.selection);
                    }}
                  >
                    <strong>{option.selection.displayName}</strong>
                    {option.requestResolution ? (
                      <small>Approved from your ingredient request</small>
                    ) : option.selection.displayName !==
                      option.selection.canonicalName ? (
                      <small>
                        Catalog name: {option.selection.canonicalName}
                      </small>
                    ) : option.ingredient.aliases.length > 0 ? (
                      <small>
                        Also known as: {option.ingredient.aliases.join(", ")}
                      </small>
                    ) : (
                      <small>Approved ingredient</small>
                    )}
                  </li>
                );
              })}
            </ul>

            {searching ? (
              <InlineLoading
                className="ingredient-picker__popup-state"
                label="Searching ingredients…"
              />
            ) : null}
            {!searching && hasSearched && approvedOptions.length === 0 ? (
              <p className="ingredient-picker__popup-state">
                No approved ingredients match.
              </p>
            ) : null}

            {pendingSuggestions.length > 0 ? (
              <div
                className="ingredient-picker__pending-results"
                role="region"
                aria-label="Pending ingredient requests"
              >
                {pendingSuggestions.map((request) => (
                  <div
                    key={request.id}
                    className="ingredient-picker__pending-result"
                  >
                    <strong>{request.proposedName}</strong>
                    <small>Pending review · not available yet</small>
                  </div>
                ))}
              </div>
            ) : null}

            <button
              className="ingredient-picker__request-action"
              type="button"
              aria-label="Request missing ingredient"
              aria-controls={`${idPrefix}-request-dialog`}
              aria-haspopup="dialog"
              disabled={disabled}
              onClick={() => {
                setPopupOpen(false);
                setRequestOpen(true);
              }}
            >
              <span>Request missing ingredient</span>
              <small>
                {query.trim()
                  ? `Can’t find “${query.trim()}”?`
                  : "Can’t find what you need?"}
              </small>
            </button>
          </div>
        ) : null}
      </div>

      {requestValue ? (
        <span
          className={`ingredient-picker__request-status is-${requestValue.status}`}
        >
          <span className="ingredient-picker__request-status-dot" aria-hidden="true" />
          {requestState}
        </span>
      ) : null}

      {failedSearchResources.length > 0 ? (
        <div className="ingredient-picker__alert" role="alert">
          <span>{searchFailureMessage(failedSearchResources)}</span>{" "}
          <LoadingButton
            className="button button--quiet"
            type="button"
            pending={searching}
            pendingLabel="Trying again…"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setSearching(true);
              setSearchStatus("Searching ingredients…");
              setSearchRetryRevision((revision) => revision + 1);
            }}
          >
            Try again
          </LoadingButton>
        </div>
      ) : null}
      {authenticationSearchError ? (
        <p className="ingredient-picker__alert" role="alert">
          {authenticationSearchError}
        </p>
      ) : null}
      <p
        id={statusId}
        className="visually-hidden"
        role={searching && popupOpen ? undefined : "status"}
        aria-live={searching && popupOpen ? undefined : "polite"}
      >
        {requestValue ? `${requestState}. ` : ""}
        {searchStatus}
      </p>

      {requestOpen ? (
        <MissingIngredientRequestPanel
          disabled={disabled}
          idPrefix={idPrefix}
          initialName={query.trim()}
          onClose={closeRequest}
          onSubmitted={(request) => {
            setRequestOpen(false);
            setQuery(request.proposed_name);
            setSearchActive(false);
            setHasSearched(false);
            setSearchStatus(
              `${request.proposed_name} is pending review and cannot be used yet.`,
            );
            onRequestSubmitted?.(request);
            window.setTimeout(() => inputRef.current?.focus(), 0);
          }}
        />
      ) : null}
    </div>
  );
}
