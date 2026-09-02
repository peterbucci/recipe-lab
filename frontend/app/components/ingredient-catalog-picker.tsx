"use client";

import {
  type FocusEvent,
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
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
import { isAbortError } from "../../lib/abort-error";
import { retryTransientRead } from "../../lib/api-transport/transient-read-retry";
import {
  createIngredientCatalogPickerState,
  ingredientCatalogPickerReducer,
  type IngredientSearchResource,
} from "../../lib/ingredient-catalog-picker-state";
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

const SEARCH_DELAY_MS = 200;
const MINIMUM_QUERY_LENGTH = 2;

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
  const suppressFocusOpenRef = useRef(false);
  const selectionDisplayName =
    value?.displayName ?? requestValue?.proposed_name ?? "";
  const selectionKey = value
    ? `catalog:${value.ingredientId}:${value.canonicalName}:${value.displayName}`
    : requestValue
      ? `request:${requestValue.id}:${requestValue.status}:${requestValue.proposed_name}:${requestValue.resolved_ingredient?.id ?? ""}`
      : "";
  const [pickerState, dispatch] = useReducer(
    ingredientCatalogPickerReducer,
    { disabled, query: selectionDisplayName, selectionKey },
    createIngredientCatalogPickerState,
  );

  if (
    selectionKey !== pickerState.selectionKey ||
    disabled !== pickerState.disabled
  ) {
    dispatch({
      type: "synchronize",
      disabled,
      query: selectionDisplayName,
      selectionKey,
    });
  }

  const {
    activeIndex,
    authenticationSearchError,
    failedSearchResources,
    hasSearched,
    pendingRequests,
    popupOpen,
    query,
    requestOpen,
    resultPage,
    searchedQuery,
    searching,
    searchActive,
    searchRetryRevision,
    searchStatus,
  } = pickerState;

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
      dispatch({ type: "search-started", query: normalizedQuery });

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
          }
          if (requestResult.status === "fulfilled") {
            pendingRequestsRef.current = requestResult.value.items;
            pendingRequestTotalRef.current = requestResult.value.total;
          }

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
          const approvedCount = resultPageRef.current?.total ?? 0;
          const pendingCount = pendingRequestTotalRef.current;
          let nextSearchStatus = "";
          if (
            catalogResult.status === "fulfilled" &&
            requestResult.status === "fulfilled" &&
            approvedCount === 0 &&
            pendingCount === 0
          ) {
            nextSearchStatus = `No ingredients match ${normalizedQuery}.`;
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
            nextSearchStatus = `${parts.join(" and ")} found.`;
          } else if (failedResources.length > 0 || authenticationError) {
            nextSearchStatus = "Some ingredient suggestions are unavailable.";
          }

          dispatch({
            type: "search-settled",
            authenticationSearchError: authenticationError,
            catalogPage:
              catalogResult.status === "fulfilled"
                ? catalogResult.value
                : undefined,
            failedSearchResources: failedResources,
            pendingRequests:
              requestResult.status === "fulfilled"
                ? requestResult.value.items
                : undefined,
            popupOpen: inputFocusedRef.current,
            searchStatus: nextSearchStatus,
          });
        })
        .finally(() => {
          if (sequence === searchSequenceRef.current && !disabledRef.current) {
            dispatch({ type: "search-finished" });
          }
        });
    }, SEARCH_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [disabled, query, searchActive, searchRetryRevision]);

  function invalidateSearchRequest() {
    searchControllerRef.current?.abort();
    searchSequenceRef.current += 1;
    resultPageRef.current = null;
    pendingRequestsRef.current = [];
    pendingRequestTotalRef.current = 0;
  }

  function selectCatalogIngredient(selection: CatalogIngredientSelection) {
    if (disabled) return;
    invalidateSearchRequest();
    dispatch({
      type: "ingredient-selected",
      query: selection.displayName,
      searchStatus: `${selection.displayName} selected for ${contextLabel}.`,
      selectionKey: `catalog:${selection.ingredientId}:${selection.canonicalName}:${selection.displayName}`,
    });
    onChange(selection);
    if (document.activeElement !== inputRef.current) {
      suppressFocusOpenRef.current = true;
      inputRef.current?.focus();
      suppressFocusOpenRef.current = false;
    }
  }

  function handleComboboxKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && approvedOptions.length > 0) {
      event.preventDefault();
      dispatch({
        type: "move-active",
        direction: "next",
        optionCount: approvedOptions.length,
      });
      return;
    }
    if (event.key === "ArrowUp" && approvedOptions.length > 0) {
      event.preventDefault();
      dispatch({
        type: "move-active",
        direction: "previous",
        optionCount: approvedOptions.length,
      });
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
      invalidateSearchRequest();
      dispatch({ type: "suggestions-closed" });
      if (document.activeElement !== inputRef.current)
        inputRef.current?.focus();
    }
  }

  function closeRequest() {
    dispatch({ type: "request-closed" });
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }

  function handleInputBlur(event: FocusEvent<HTMLInputElement>) {
    inputFocusedRef.current = false;
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && popupRef.current?.contains(nextTarget)) {
      return;
    }
    dispatch({ type: "blur" });
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
            if (suppressFocusOpenRef.current) return;
            dispatch({ type: "focus" });
          }}
          onChange={(event) => {
            const nextQuery = event.target.value;
            const clearsSelection =
              Boolean(value || requestValue) &&
              nextQuery !== selectionDisplayName;
            invalidateSearchRequest();
            dispatch({
              type: "input-changed",
              query: nextQuery,
              searchStatus:
                nextQuery.trim().length > 0 &&
                nextQuery.trim().length < MINIMUM_QUERY_LENGTH
                  ? `Type at least ${MINIMUM_QUERY_LENGTH} characters to search.`
                  : "",
              selectionKey: clearsSelection ? "" : selectionKey,
            });
            if (clearsSelection) {
              onChange(null);
            }
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
                dispatch({ type: "request-opened" });
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
              dispatch({ type: "retry-requested" });
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
            dispatch({
              type: "request-submitted",
              query: request.proposed_name,
              searchStatus: `${request.proposed_name} is pending review and cannot be used yet.`,
              selectionKey: `request:${request.id}:${request.status}:${request.proposed_name}:`,
            });
            onRequestSubmitted?.(request);
            window.setTimeout(() => inputRef.current?.focus(), 0);
          }}
        />
      ) : null}
    </div>
  );
}
