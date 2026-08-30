"use client";

import { useEffect, useId, useMemo, useState } from "react";

import type { RecipeCategory } from "../../lib/recipe-api";
import { fetchActiveRecipeCategories } from "../../lib/recipe-category-client-api";
import { MAX_RECIPE_CATEGORIES } from "../../lib/recipe-category";
import { RecipeDraftFieldError } from "./recipe-draft-field-error";

interface RecipeCategorySelectorProps {
  disabled?: boolean;
  error?: string;
  onChange: (categories: RecipeCategory[]) => void;
  value: readonly RecipeCategory[];
}

type LoadState = "error" | "loading" | "ready";

function isAbortError(reason: unknown): boolean {
  return (
    reason instanceof DOMException &&
    reason.name === "AbortError"
  );
}

export function RecipeCategorySelector({
  disabled = false,
  error,
  onChange,
  value,
}: RecipeCategorySelectorProps) {
  const descriptionId = useId();
  const errorId = `${descriptionId}-error`;
  const statusId = `${descriptionId}-status`;
  const [activeCategories, setActiveCategories] = useState<RecipeCategory[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
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
  }, [requestVersion]);

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

  return (
    <fieldset className="draft-editor__surface draft-editor__surface--categories">
      <legend>Recipe categories</legend>
      <p id={descriptionId}>
        Choose up to {MAX_RECIPE_CATEGORIES} from Recipe Lab’s curated list.
        Categories help cooks browse recipes and cannot be entered as free text.
      </p>

      {loadState === "loading" ? (
        <p role="status">Loading curated categories…</p>
      ) : null}
      {loadState === "error" ? (
        <div className="form-alert" role="alert">
          <p>
            Curated categories could not be loaded. Your existing selections
            are still here.
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

      {choices.length > 0 ? (
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
              <label key={category.id} className="draft-category-selector__option">
                <input
                  aria-invalid={error ? "true" : undefined}
                  checked={checked}
                  disabled={choiceDisabled}
                  name="recipe-categories"
                  onChange={(event) => toggle(category, event.currentTarget.checked)}
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
      ) : loadState === "ready" ? (
        <p>No curated categories are available right now.</p>
      ) : null}

      <p id={statusId} role="status" aria-live="polite">
        {value.length} of {MAX_RECIPE_CATEGORIES} categories selected.
        {atLimit ? " Clear one selection before choosing another." : ""}
      </p>
      <RecipeDraftFieldError id={errorId} message={error} />
    </fieldset>
  );
}
