"use client";

import {
  type KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";

import type { RecipeCategory } from "../../lib/recipe-api";
import { fetchActiveRecipeCategories } from "../../lib/recipe-category-client-api";
import { MAX_RECIPE_CATEGORIES } from "../../lib/recipe-category";
import { EditorRowIcon } from "./editor-row-icon";
import { InlineLoading, SectionLoading } from "./loading-ui";
import { RecipeDraftFieldError } from "./recipe-draft-field-error";
import { useFloatingPanelPlacement } from "./use-floating-panel-placement";

interface RecipeCategorySelectorProps {
  disabled?: boolean;
  error?: string;
  initialActiveCategories?: readonly RecipeCategory[];
  onChange: (categories: RecipeCategory[]) => void;
  presentation?: "default" | "recipe";
  value: readonly RecipeCategory[];
}

type LoadState = "error" | "loading" | "ready";

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

export function RecipeCategorySelector({
  disabled = false,
  error,
  initialActiveCategories,
  onChange,
  presentation = "default",
  value,
}: RecipeCategorySelectorProps) {
  const descriptionId = useId();
  const errorId = `${descriptionId}-error`;
  const popoverId = `${descriptionId}-popover`;
  const statusId = `${descriptionId}-status`;
  const selectorRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [activeCategories, setActiveCategories] = useState<RecipeCategory[]>(
    () => [...(initialActiveCategories ?? [])],
  );
  const [editingCategories, setEditingCategories] = useState(false);
  const [loadState, setLoadState] = useState<LoadState>(
    initialActiveCategories === undefined ? "loading" : "ready",
  );
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    if (initialActiveCategories !== undefined) return;

    const controller = new AbortController();
    let active = true;

    void fetchActiveRecipeCategories(controller.signal)
      .then((result) => {
        if (!active) return;
        setActiveCategories([...result.items]);
        setLoadState("ready");
      })
      .catch((reason: unknown) => {
        if (!active || isAbortError(reason)) return;
        setLoadState("error");
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [initialActiveCategories, requestVersion]);

  const activeIds = useMemo(
    () => new Set(activeCategories.map((category) => category.id)),
    [activeCategories],
  );
  const choices = useMemo(() => {
    const knownIds = new Set(activeCategories.map((category) => category.id));
    return [
      ...activeCategories,
      ...value.filter((category) => !knownIds.has(category.id)),
    ];
  }, [activeCategories, value]);
  const selectedIds = useMemo(
    () => new Set(value.map((category) => category.id)),
    [value],
  );
  const atLimit = value.length >= MAX_RECIPE_CATEGORIES;
  const describedBy = [descriptionId, statusId, error ? errorId : ""]
    .filter(Boolean)
    .join(" ");
  const showCategoryPopover = presentation === "recipe" && editingCategories;
  const popoverPlacement = useFloatingPanelPlacement({
    contentKey: `${loadState}-${choices.length}`,
    open: showCategoryPopover,
    panelRef: popoverRef,
    triggerRef,
  });

  useEffect(() => {
    if (!showCategoryPopover) return;

    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !selectorRef.current?.contains(target)) {
        setEditingCategories(false);
      }
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    return () => document.removeEventListener("pointerdown", closeWhenOutside);
  }, [showCategoryPopover]);

  function closeCategoryPopover() {
    setEditingCategories(false);
    window.setTimeout(() => triggerRef.current?.focus(), 0);
  }

  function handlePopoverKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    closeCategoryPopover();
  }

  function toggle(category: RecipeCategory, checked: boolean) {
    const nextIds = new Set(selectedIds);
    if (checked) {
      if (nextIds.has(category.id) || nextIds.size >= MAX_RECIPE_CATEGORIES) {
        return;
      }
      nextIds.add(category.id);
    } else {
      nextIds.delete(category.id);
    }
    onChange(choices.filter((choice) => nextIds.has(choice.id)));
  }

  function categoryOptions() {
    if (choices.length === 0) {
      return loadState === "ready" ? (
        <p>No curated categories are available right now.</p>
      ) : null;
    }
    return (
      <div
        className="draft-category-selector__options"
        role="group"
        aria-label="Curated recipe categories"
        aria-describedby={describedBy}
      >
        {choices.map((category) => {
          const checked = selectedIds.has(category.id);
          const active = activeIds.has(category.id);
          const unavailable = loadState === "ready" && !active;
          const unconfirmed = loadState !== "ready" && !active;
          const choiceDisabled =
            disabled || (!checked && (atLimit || unavailable || unconfirmed));
          return (
            <label
              key={category.id}
              className="draft-category-selector__option"
            >
              <input
                aria-invalid={error ? "true" : undefined}
                checked={checked}
                disabled={choiceDisabled}
                name="recipe-categories"
                onChange={(event) =>
                  toggle(category, event.currentTarget.checked)
                }
                type="checkbox"
                value={category.id}
              />
              <span>{category.name}</span>
              {unavailable ? (
                <small>Previously selected; no longer available</small>
              ) : unconfirmed ? (
                <small>Saved selection; availability not confirmed</small>
              ) : null}
            </label>
          );
        })}
      </div>
    );
  }

  if (presentation === "recipe") {
    return (
      <div
        ref={selectorRef}
        className="recipe-workspace__category-selector"
        role="group"
        aria-label="Recipe categories"
      >
        <p className="visually-hidden" id={descriptionId}>
          Choose up to {MAX_RECIPE_CATEGORIES} from Recipe Lab’s curated list.
        </p>
        <div className="recipe-workspace__category-summary">
          {value.length > 0 ? (
            <ul
              className="recipe-category-list"
              aria-label="Selected recipe categories"
            >
              {value.map((category) => (
                <li key={category.id}>{category.name}</li>
              ))}
            </ul>
          ) : (
            <span className="recipe-workspace__category-empty">
              No categories yet
            </span>
          )}
          <button
            ref={triggerRef}
            className="button button--quiet recipe-workspace__category-toggle"
            type="button"
            disabled={disabled}
            aria-label="Edit categories"
            aria-controls={popoverId}
            aria-expanded={editingCategories}
            aria-haspopup="dialog"
            onClick={() => setEditingCategories((open) => !open)}
            title="Edit categories"
          >
            <EditorRowIcon kind="menu" />
          </button>
          {editingCategories ? (
            <div
              ref={popoverRef}
              id={popoverId}
              className="recipe-workspace__category-choices"
              role="dialog"
              aria-label="Edit recipe categories"
              data-placement={popoverPlacement.placement}
              style={popoverPlacement.style}
              onKeyDown={handlePopoverKeyDown}
            >
              {loadState === "loading" ? (
                <InlineLoading label="Loading curated categories…" />
              ) : null}
              {loadState === "error" ? (
                <div className="form-alert" role="alert">
                  <p>
                    Curated categories could not be loaded. Your existing
                    selections are still here.
                  </p>
                  <button
                    className="button button--secondary"
                    disabled={disabled}
                    onClick={() => {
                      setLoadState("loading");
                      setRequestVersion((version) => version + 1);
                    }}
                    type="button"
                  >
                    Try loading categories again
                  </button>
                </div>
              ) : null}
              {categoryOptions()}
              <div className="recipe-workspace__category-actions">
                <button
                  className="button button--primary recipe-workspace__category-done"
                  type="button"
                  onClick={closeCategoryPopover}
                >
                  Done
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <p
          className="visually-hidden"
          id={statusId}
          role="status"
          aria-live="polite"
        >
          {value.length} of {MAX_RECIPE_CATEGORIES} categories selected.
          {atLimit ? " Clear one selection before choosing another." : ""}
        </p>
        <RecipeDraftFieldError id={errorId} message={error} />
      </div>
    );
  }

  return (
    <fieldset className="draft-editor__surface draft-editor__surface--categories">
      <legend>Recipe categories</legend>
      <p id={descriptionId}>
        Choose up to {MAX_RECIPE_CATEGORIES} from Recipe Lab’s curated list.
        Categories help cooks browse recipes and cannot be entered as free text.
      </p>

      {loadState === "loading" ? (
        <SectionLoading
          count={2}
          label="Loading curated categories…"
          layout="rows"
        />
      ) : null}
      {loadState === "error" ? (
        <div className="form-alert" role="alert">
          <p>
            Curated categories could not be loaded. Your existing selections are
            still here.
          </p>
          <button
            className="button button--secondary"
            disabled={disabled}
            onClick={() => {
              setLoadState("loading");
              setRequestVersion((version) => version + 1);
            }}
            type="button"
          >
            Try loading categories again
          </button>
        </div>
      ) : null}

      {categoryOptions()}

      <p id={statusId} role="status" aria-live="polite">
        {value.length} of {MAX_RECIPE_CATEGORIES} categories selected.
        {atLimit ? " Clear one selection before choosing another." : ""}
      </p>
      <RecipeDraftFieldError id={errorId} message={error} />
    </fieldset>
  );
}
