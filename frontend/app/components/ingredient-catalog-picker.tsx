"use client";

import {
  type KeyboardEvent,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  type CatalogIngredientPage,
  type CatalogIngredientSelection,
  type MissingIngredientRequest,
  searchCatalogIngredients,
  selectionForCatalogIngredient,
} from "../../lib/ingredient-catalog-api";
import { MemberIngredientRequestHistory } from "./member-ingredient-request-history";
import { MissingIngredientRequestPanel } from "./missing-ingredient-request-panel";

interface IngredientCatalogPickerProps {
  contextLabel: string;
  describedBy?: string;
  disabled?: boolean;
  idPrefix: string;
  invalid?: boolean;
  label: string;
  onChange: (selection: CatalogIngredientSelection | null) => void;
  onRequestSubmitted?: (request: MissingIngredientRequest) => void;
  value: CatalogIngredientSelection | null;
}

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

export function IngredientCatalogPicker({
  contextLabel,
  describedBy,
  disabled = false,
  idPrefix,
  invalid = false,
  label,
  onChange,
  onRequestSubmitted,
  value,
}: IngredientCatalogPickerProps) {
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLLIElement | null>>([]);
  const requestTriggerRef = useRef<HTMLButtonElement>(null);
  const disabledRef = useRef(disabled);
  const searchControllerRef = useRef<AbortController | null>(null);
  const searchSequenceRef = useRef(0);
  const [query, setQuery] = useState(value?.displayName ?? "");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [resultPage, setResultPage] = useState<CatalogIngredientPage | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchActive, setSearchActive] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [popupOpen, setPopupOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestSelectionStatus, setRequestSelectionStatus] = useState("");
  const selectionKey = value
    ? `${value.ingredientId}:${value.canonicalName}:${value.displayName}`
    : "";
  const [syncedSelectionKey, setSyncedSelectionKey] = useState(selectionKey);
  const [syncedDisabled, setSyncedDisabled] = useState(disabled);

  if (selectionKey !== syncedSelectionKey) {
    setSyncedSelectionKey(selectionKey);
    setQuery(value?.displayName ?? "");
    setSearchActive(false);
    setSearching(false);
    setResultPage(null);
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
      setPopupOpen(false);
      setActiveIndex(-1);
      setHasSearched(false);
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

  useEffect(() => {
    searchControllerRef.current?.abort();
    searchSequenceRef.current += 1;
  }, [selectionKey]);

  useEffect(() => {
    if (!disabled) return;
    searchControllerRef.current?.abort();
    searchSequenceRef.current += 1;
  }, [disabled]);

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
      setSearchError("");
      setSearchStatus("Searching the ingredient catalog…");
      setSearchedQuery(normalizedQuery);
      setHasSearched(false);
      setPopupOpen(false);
      setActiveIndex(-1);

      void searchCatalogIngredients({
        query: normalizedQuery,
        page: 1,
        pageSize: 8,
        signal: controller.signal,
      })
        .then((results) => {
          if (sequence !== searchSequenceRef.current || disabledRef.current) return;
          setResultPage(results);
          setHasSearched(true);
          setPopupOpen(results.items.length > 0);
          setSearchStatus(
            results.total === 0
              ? `No approved ingredients match ${normalizedQuery}.`
              : `${results.total} approved ingredient${results.total === 1 ? "" : "s"} found. Use the arrow keys to review suggestions.`,
          );
        })
        .catch((reason: unknown) => {
          if (isAbortError(reason)) return;
          if (sequence !== searchSequenceRef.current || disabledRef.current) return;
          setResultPage(null);
          setHasSearched(false);
          setPopupOpen(false);
          setSearchStatus("");
          setSearchError("The ingredient catalog could not be searched. Please try again.");
        })
        .finally(() => {
          if (sequence === searchSequenceRef.current && !disabledRef.current) {
            setSearching(false);
          }
        });
    }, SEARCH_DELAY_MS);

    return () => window.clearTimeout(timeout);
  }, [disabled, query, searchActive]);

  function invalidateSearch() {
    searchControllerRef.current?.abort();
    searchSequenceRef.current += 1;
    setSearching(false);
    setResultPage(null);
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
    setSearchError("");
    setHistoryOpen(false);
    setRequestSelectionStatus("");
    setSearchStatus(`${selection.displayName} selected for ${contextLabel}.`);
    onChange(selection);
    inputRef.current?.focus();
  }

  function handleComboboxKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const items = resultPage?.items ?? [];
    if (event.key === "ArrowDown" && items.length > 0) {
      event.preventDefault();
      setPopupOpen(true);
      setActiveIndex((current) => (current < items.length - 1 ? current + 1 : 0));
      return;
    }
    if (event.key === "ArrowUp" && items.length > 0) {
      event.preventDefault();
      setPopupOpen(true);
      setActiveIndex((current) => (current > 0 ? current - 1 : items.length - 1));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      if (popupOpen && activeIndex >= 0) {
        const ingredient = items[activeIndex];
        if (ingredient) {
          selectCatalogIngredient(
            selectionForCatalogIngredient(ingredient, searchedQuery),
          );
        }
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
      if (document.activeElement !== inputRef.current) inputRef.current?.focus();
    }
  }

  function closeRequest() {
    setRequestOpen(false);
    window.setTimeout(() => requestTriggerRef.current?.focus(), 0);
  }

  function closeHistory() {
    setHistoryOpen(false);
    window.setTimeout(() => historyTriggerRef.current?.focus(), 0);
  }

  function selectRequestResolution(selection: CatalogIngredientSelection) {
    if (disabled) return;
    invalidateSearch();
    setSearchActive(false);
    setHasSearched(false);
    setQuery(selection.displayName);
    setSearchError("");
    onChange(selection);
    setHistoryOpen(false);
    setRequestSelectionStatus(
      `${selection.canonicalName} was selected from your resolved ingredient requests for ${contextLabel}.`,
    );
    window.setTimeout(() => historyTriggerRef.current?.focus(), 0);
  }

  const helpId = `${idPrefix}-search-help`;
  const statusId = `${idPrefix}-search-status`;
  const listboxId = `${idPrefix}-suggestions`;
  const activeOptionId =
    popupOpen && activeIndex >= 0 ? `${idPrefix}-option-${activeIndex}` : undefined;
  const inputDescription = [helpId, statusId, describedBy].filter(Boolean).join(" ");

  return (
    <div className="ingredient-picker">
      <label htmlFor={`${idPrefix}-search`}>{label}</label>
      <small id={helpId}>
        Start typing an approved ingredient or alternate name, then choose a suggestion.
      </small>

      <div className="ingredient-picker__combobox">
        <input
          ref={inputRef}
          id={`${idPrefix}-search`}
          type="search"
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
          placeholder="Try pecan or white sugar"
          onBlur={() => setPopupOpen(false)}
          onFocus={() => {
            if (!disabled && resultPage?.items.length) setPopupOpen(true);
          }}
          onChange={(event) => {
            const nextQuery = event.target.value;
            invalidateSearch();
            setQuery(nextQuery);
            setSearchActive(true);
            setSearchError("");
            setSearchStatus(
              nextQuery.trim().length > 0 &&
                nextQuery.trim().length < MINIMUM_QUERY_LENGTH
                ? `Type at least ${MINIMUM_QUERY_LENGTH} characters to search.`
                : "",
            );
            setHasSearched(false);
            setRequestSelectionStatus("");
          }}
          onKeyDown={handleComboboxKeyDown}
        />

        {popupOpen && resultPage && resultPage.items.length > 0 ? (
          <ul
            id={listboxId}
            className="ingredient-picker__results"
            role="listbox"
            aria-label={`${label} suggestions`}
          >
            {resultPage.items.map((ingredient, index) => {
              const selection = selectionForCatalogIngredient(ingredient, searchedQuery);
              const selected =
                value?.ingredientId === selection.ingredientId &&
                value.displayName === selection.displayName;
              return (
                <li
                  ref={(node) => {
                    optionRefs.current[index] = node;
                  }}
                  id={`${idPrefix}-option-${index}`}
                  key={ingredient.id}
                  role="option"
                  tabIndex={-1}
                  aria-selected={selected}
                  aria-disabled={disabled}
                  className={index === activeIndex ? "is-active" : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onKeyDown={(event) => {
                    if (!disabled && (event.key === "Enter" || event.key === " ")) {
                      event.preventDefault();
                      selectCatalogIngredient(selection);
                    }
                  }}
                  onClick={() => {
                    if (!disabled) selectCatalogIngredient(selection);
                  }}
                >
                  <strong>{selection.displayName}</strong>
                  {selection.displayName !== selection.canonicalName ? (
                    <small>Catalog name: {selection.canonicalName}</small>
                  ) : ingredient.aliases.length > 0 ? (
                    <small>Also known as: {ingredient.aliases.join(", ")}</small>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>

      {value ? (
        <div className="ingredient-picker__selection" aria-live="polite">
          <div>
            <span>Selected ingredient</span>
            <strong>{value.displayName}</strong>
            {value.displayName !== value.canonicalName ? (
              <small>Catalog name: {value.canonicalName}</small>
            ) : null}
          </div>
          <button
            className="button button--quiet"
            type="button"
            disabled={disabled}
            onClick={() => {
              invalidateSearch();
              setQuery("");
              setSearchActive(false);
              setHasSearched(false);
              setSearchError("");
              setSearchStatus("Ingredient selection cleared.");
              setRequestSelectionStatus("");
              setHistoryOpen(false);
              onChange(null);
              inputRef.current?.focus();
            }}
          >
            Clear ingredient
          </button>
        </div>
      ) : null}

      {searchError ? (
        <p className="ingredient-picker__alert" role="alert">
          {searchError}
        </p>
      ) : null}
      <p id={statusId} className="ingredient-picker__status" role="status" aria-live="polite">
        {searchStatus}
      </p>

      <div className="ingredient-picker__support">
        <button
          ref={historyTriggerRef}
          className="button button--quiet"
          type="button"
          aria-expanded={historyOpen}
          aria-controls={`${idPrefix}-history-panel`}
          aria-label={
            historyOpen
              ? `Hide my ingredient requests for ${contextLabel}`
              : `Choose from my ingredient requests for ${contextLabel}`
          }
          disabled={disabled}
          onClick={() => {
            setRequestSelectionStatus("");
            setHistoryOpen((current) => !current);
          }}
        >
          {historyOpen ? "Hide requested ingredients" : "Use a requested ingredient"}
        </button>

        {hasSearched && query.trim() ? (
          <button
            ref={requestTriggerRef}
            className="button button--quiet"
            type="button"
            aria-expanded={requestOpen}
            aria-controls={`${idPrefix}-request-panel`}
            disabled={disabled}
            onClick={() => setRequestOpen((current) => !current)}
          >
            {requestOpen ? "Hide missing ingredient request" : "Request a missing ingredient"}
          </button>
        ) : null}
      </div>

      {requestSelectionStatus ? (
        <p className="ingredient-picker__request-status" role="status" aria-live="polite">
          {requestSelectionStatus}
        </p>
      ) : null}

      {historyOpen ? (
        <div id={`${idPrefix}-history-panel`}>
          <MemberIngredientRequestHistory
            idPrefix={`${idPrefix}-history`}
            contextLabel={contextLabel}
            pageSize={10}
            onClose={closeHistory}
            onSelectResolution={selectRequestResolution}
          />
        </div>
      ) : null}

      {requestOpen ? (
        <div id={`${idPrefix}-request-panel`}>
          <MissingIngredientRequestPanel
            disabled={disabled}
            idPrefix={idPrefix}
            initialName={query.trim()}
            onClose={closeRequest}
            onSubmitted={onRequestSubmitted}
          />
        </div>
      ) : null}
    </div>
  );
}
