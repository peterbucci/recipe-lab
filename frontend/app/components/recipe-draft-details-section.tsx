import type { ReactNode } from "react";

import { RecipeDraftFieldError } from "./recipe-draft-field-error";

interface RecipeDraftIdentityFieldsProps {
  description: string;
  disabled: boolean;
  errors: Readonly<{
    description?: string;
    title?: string;
  }>;
  isVersion: boolean;
  onDescriptionChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  title: string;
  titleContext?: ReactNode;
}

interface RecipeDraftFactsFieldsProps {
  activeTimeMinutes: string;
  difficulty: "easy" | "medium" | "hard" | "";
  disabled: boolean;
  errors: Readonly<{
    activeTimeMinutes?: string;
    difficulty?: string;
    servings?: string;
    totalTimeMinutes?: string;
  }>;
  onActiveTimeMinutesChange: (value: string) => void;
  onDifficultyChange: (value: "easy" | "medium" | "hard" | "") => void;
  onServingsChange: (value: string) => void;
  onTotalTimeMinutesChange: (value: string) => void;
  servings: string;
  totalTimeMinutes: string;
}

export function RecipeDraftIdentityFields({
  description,
  disabled,
  errors,
  isVersion,
  onDescriptionChange,
  onTitleChange,
  title,
  titleContext,
}: RecipeDraftIdentityFieldsProps) {
  const titlePlaceholder = isVersion ? "Untitled version" : "Untitled recipe";
  const descriptionPlaceholder = "Add a short description of this recipe.";

  return (
    <>
      <h1 className="recipe-workspace__title-heading">
        <label className="visually-hidden" htmlFor="draft-title">
          Title
        </label>
        <span className="recipe-workspace__title-mirror" aria-hidden="true">
          {title || titlePlaceholder}
        </span>
        <textarea
          id="draft-title"
          className="recipe-workspace__title-input recipe-workspace__editable-text"
          value={title}
          maxLength={200}
          rows={1}
          disabled={disabled}
          aria-invalid={Boolean(errors.title)}
          aria-describedby={errors.title ? "draft-title-error" : undefined}
          placeholder={titlePlaceholder}
          onChange={(event) =>
            onTitleChange(event.target.value.replace(/[\r\n]+/g, " "))
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
      </h1>
      <RecipeDraftFieldError id="draft-title-error" message={errors.title} />
      {titleContext}
      <div className="recipe-workspace__description-field">
        <label className="visually-hidden" htmlFor="draft-description">
          Description
        </label>
        <span
          className="recipe-detail__description recipe-workspace__description-mirror"
          aria-hidden="true"
        >
          {description || descriptionPlaceholder}
        </span>
        <textarea
          id="draft-description"
          className="recipe-detail__description recipe-workspace__description-input recipe-workspace__editable-text"
          value={description}
          maxLength={2000}
          rows={1}
          disabled={disabled}
          aria-invalid={Boolean(errors.description)}
          aria-describedby={
            errors.description ? "draft-description-error" : undefined
          }
          placeholder={descriptionPlaceholder}
          onChange={(event) => onDescriptionChange(event.target.value)}
        />
        <RecipeDraftFieldError
          id="draft-description-error"
          message={errors.description}
        />
      </div>
    </>
  );
}

export function RecipeDraftFactsFields({
  activeTimeMinutes,
  difficulty,
  disabled,
  errors,
  onActiveTimeMinutesChange,
  onDifficultyChange,
  onServingsChange,
  onTotalTimeMinutesChange,
  servings,
  totalTimeMinutes,
}: RecipeDraftFactsFieldsProps) {
  return (
    <div
      className="recipe-facts recipe-detail__facts recipe-workspace__facts"
      role="group"
      aria-label="Recipe facts"
    >
      <dl>
        <div>
          <dt>
            <label htmlFor="draft-total-time">Total time</label>
          </dt>
          <dd>
            <span className="recipe-workspace__fact-control">
              <input
                id="draft-total-time"
                type="number"
                min={1}
                max={525600}
                step={1}
                disabled={disabled}
                inputMode="numeric"
                value={totalTimeMinutes}
                aria-invalid={Boolean(errors.totalTimeMinutes)}
                aria-describedby={
                  errors.totalTimeMinutes ? "draft-total-time-error" : undefined
                }
                placeholder="—"
                onChange={(event) =>
                  onTotalTimeMinutesChange(event.target.value)
                }
              />
              <span aria-hidden="true">min</span>
            </span>
            <RecipeDraftFieldError
              id="draft-total-time-error"
              message={errors.totalTimeMinutes}
            />
          </dd>
        </div>
        <div>
          <dt>
            <label htmlFor="draft-active-time">Active time</label>
          </dt>
          <dd>
            <span className="recipe-workspace__fact-control">
              <input
                id="draft-active-time"
                type="number"
                min={1}
                max={525600}
                step={1}
                disabled={disabled}
                inputMode="numeric"
                value={activeTimeMinutes}
                aria-invalid={Boolean(errors.activeTimeMinutes)}
                aria-describedby={
                  errors.activeTimeMinutes
                    ? "draft-active-time-error"
                    : undefined
                }
                placeholder="—"
                onChange={(event) =>
                  onActiveTimeMinutesChange(event.target.value)
                }
              />
              <span aria-hidden="true">min</span>
            </span>
            <RecipeDraftFieldError
              id="draft-active-time-error"
              message={errors.activeTimeMinutes}
            />
          </dd>
        </div>
        <div>
          <dt>
            <label htmlFor="draft-servings">Makes</label>
          </dt>
          <dd>
            <span className="recipe-workspace__fact-control">
              <input
                id="draft-servings"
                value={servings}
                disabled={disabled}
                inputMode="decimal"
                aria-invalid={Boolean(errors.servings)}
                aria-describedby={
                  errors.servings ? "draft-servings-error" : undefined
                }
                placeholder="—"
                onChange={(event) => onServingsChange(event.target.value)}
              />
              <span aria-hidden="true">servings</span>
            </span>
            <RecipeDraftFieldError
              id="draft-servings-error"
              message={errors.servings}
            />
          </dd>
        </div>
        <div>
          <dt>
            <label htmlFor="draft-difficulty">Difficulty</label>
          </dt>
          <dd>
            <select
              id="draft-difficulty"
              value={difficulty}
              disabled={disabled}
              aria-invalid={Boolean(errors.difficulty)}
              aria-describedby={
                errors.difficulty ? "draft-difficulty-error" : undefined
              }
              onChange={(event) =>
                onDifficultyChange(
                  event.target.value as "easy" | "medium" | "hard" | "",
                )
              }
            >
              <option value="">Not specified</option>
              <option value="easy">Easy</option>
              <option value="medium">Medium</option>
              <option value="hard">Hard</option>
            </select>
            <RecipeDraftFieldError
              id="draft-difficulty-error"
              message={errors.difficulty}
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}
