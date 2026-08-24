"use client";

import {
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  type CatalogIngredientPage,
  type CatalogIngredientSelection,
  IngredientCatalogApiError,
  searchCatalogIngredients,
  selectionForCatalogIngredient,
} from "../../lib/ingredient-catalog-api";
import { MissingIngredientRequestPanel } from "./missing-ingredient-request-panel";

interface IngredientCatalogPickerProps {
  contextLabel: string;
  describedBy?: string;
  disabled?: boolean;
  idPrefix: string;
  invalid?: boolean;
  label: string;
  onChange: (selection: CatalogIngredientSelection | null) => void;
  value: CatalogIngredientSelection | null;
}

export function IngredientCatalogPicker({
  contextLabel,
  describedBy,
  disabled = false,
  idPrefix,
  invalid = false,
  label,
  onChange,
  value,
}: IngredientCatalogPickerProps) {
  const requestTriggerRef = useRef<HTMLButtonElement>(null);
  const searchControllerRef = useRef<AbortController | null>(null);
  const searchSequenceRef = useRef(0);
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [resultPage, setResultPage] = useState<CatalogIngredientPage | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searchStatus, setSearchStatus] = useState("");
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);

  useEffect(
    () => () => {
      searchControllerRef.current?.abort();
    },
    [],
  );

  async function runSearch(page = 1) {
    if (disabled) {
      return;
    }

    const normalizedQuery = query.trim();
    const sequence = searchSequenceRef.current + 1;
    searchSequenceRef.current = sequence;
    searchControllerRef.current?.abort();
    const controller = new AbortController();
    searchControllerRef.current = controller;
    setSearching(true);
    setSearchError("");
    setSearchStatus("Searching the ingredient catalog…");
    setSearchedQuery(normalizedQuery);
    setHasSearched(true);

    try {
      const results = await searchCatalogIngredients({
        query: normalizedQuery,
        page,
        pageSize: 20,
        signal: controller.signal,
      });
      if (sequence !== searchSequenceRef.current) {
        return;
      }
      setResultPage(results);
      setSearchStatus(
        results.total === 0
          ? `No catalog ingredients match ${normalizedQuery || "this search"}.`
          : `${results.total} catalog ingredient${results.total === 1 ? "" : "s"} found. Showing page ${results.page} of ${results.total_pages}.`,
      );
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        return;
      }
      if (sequence !== searchSequenceRef.current) {
        return;
      }
      setResultPage(null);
      setSearchStatus("");
      setSearchError(
        reason instanceof IngredientCatalogApiError
          ? reason.message
          : "The ingredient catalog could not be searched. Please try again.",
      );
    } finally {
      if (sequence === searchSequenceRef.current) {
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

  function closeRequest() {
    setRequestOpen(false);
    window.setTimeout(() => requestTriggerRef.current?.focus(), 0);
  }

  const helpId = `${idPrefix}-search-help`;
  const statusId = `${idPrefix}-search-status`;
  const inputDescription = [helpId, statusId, describedBy].filter(Boolean).join(" ");

  return (
    <div className="ingredient-picker">
      <label htmlFor={`${idPrefix}-search`}>{label}</label>
      <small id={helpId}>
        Search canonical names and curated aliases, then choose a result. Typed search text is
        never added to the recipe by itself.
      </small>

      {value ? (
        <div className="ingredient-picker__selection" aria-live="polite">
          <div>
            <span>Selected catalog ingredient</span>
            <strong>{value.displayName}</strong>
            {value.displayName !== value.canonicalName ? (
              <small>Catalog name: {value.canonicalName}</small>
            ) : null}
          </div>
          <button
            className="button button--quiet"
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <div
        className="ingredient-picker__search"
        role="search"
        aria-label={`${label} catalog search for ${contextLabel}`}
      >
        <input
          id={`${idPrefix}-search`}
          type="search"
          autoComplete="off"
          maxLength={100}
          value={query}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={inputDescription}
          placeholder="Try pecan or white sugar"
          onChange={(event) => {
            searchControllerRef.current?.abort();
            searchSequenceRef.current += 1;
            setQuery(event.target.value);
            setResultPage(null);
            setSearchError("");
            setSearchStatus("");
            setHasSearched(false);
            setSearching(false);
          }}
          onKeyDown={handleSearchKeyDown}
        />
        <button
          className="button button--secondary"
          type="button"
          disabled={disabled || searching}
          onClick={() => void runSearch()}
        >
          {searching ? "Searching…" : "Search catalog"}
        </button>
      </div>

      {searchError ? (
        <p className="ingredient-picker__alert" role="alert">
          {searchError}
        </p>
      ) : null}
      <p
        id={statusId}
        className="ingredient-picker__status"
        role="status"
        aria-live="polite"
      >
        {searchStatus}
      </p>

      {resultPage && resultPage.items.length > 0 ? (
        <>
          <ul
            className="ingredient-picker__results"
            aria-label={`${label} catalog results`}
          >
            {resultPage.items.map((ingredient) => {
              const selection = selectionForCatalogIngredient(ingredient, searchedQuery);
              const selected =
                value?.ingredientId === selection.ingredientId &&
                value.displayName === selection.displayName;
              return (
                <li key={ingredient.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={selected}
                    onClick={() => onChange(selection)}
                  >
                    <span>
                      <strong>{selection.displayName}</strong>
                      {selection.displayName !== selection.canonicalName ? (
                        <small>Catalog name: {selection.canonicalName}</small>
                      ) : ingredient.aliases.length > 0 ? (
                        <small>Also known as: {ingredient.aliases.join(", ")}</small>
                      ) : null}
                    </span>
                    <span>{selected ? "Selected" : "Choose"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {resultPage.total_pages > 1 ? (
            <nav
              className="ingredient-picker__pagination"
              aria-label={`${label} catalog result pages`}
            >
              <button
                className="button button--quiet"
                type="button"
                disabled={disabled || searching || resultPage.page <= 1}
                onClick={() => void runSearch(resultPage.page - 1)}
              >
                ← Previous
              </button>
              <span aria-current="page">
                Page {resultPage.page} of {resultPage.total_pages}
              </span>
              <button
                className="button button--quiet"
                type="button"
                disabled={
                  disabled || searching || resultPage.page >= resultPage.total_pages
                }
                onClick={() => void runSearch(resultPage.page + 1)}
              >
                Next →
              </button>
            </nav>
          ) : null}
        </>
      ) : null}

      {hasSearched && query.trim() ? (
        <div className="ingredient-picker__missing">
          <p>Can’t find the right catalog ingredient?</p>
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
        </div>
      ) : null}

      {requestOpen ? (
        <div id={`${idPrefix}-request-panel`}>
          <MissingIngredientRequestPanel
            disabled={disabled}
            idPrefix={idPrefix}
            initialName={query.trim()}
            onClose={closeRequest}
          />
        </div>
      ) : null}
    </div>
  );
}
