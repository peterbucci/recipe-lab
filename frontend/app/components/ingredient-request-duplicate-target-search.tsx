import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  browseIngredientCatalogReviewRequests,
  type CatalogIngredientPage,
  type IngredientCatalogReviewDetail,
  type IngredientCatalogReviewPage,
  searchCatalogIngredients,
} from "../../lib/ingredient-catalog-api";
import { isAbortError } from "./ingredient-request-review-model";

interface DuplicateTargetSearchProps {
  detail: IngredientCatalogReviewDetail;
  disabled: boolean;
  inputName: string;
  onSelect: (value: string) => void;
  value: string;
}

export function DuplicateTargetSearch({
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
      <p
        id={`${idPrefix}-status`}
        className="curation-target-search__status"
        role="status"
        aria-live="polite"
      >
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
                        {candidate.aliases.length
                          ? ` · Aliases: ${candidate.aliases.join(", ")}`
                          : ""}
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
                      <small>
                        Already-approved request · Proposed as {candidate.proposed_name}
                      </small>
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
