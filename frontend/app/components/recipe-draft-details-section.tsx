import { RecipeDraftFieldError } from "./recipe-draft-field-error";

interface RecipeDraftDetailsSectionProps {
  description: string;
  disabled: boolean;
  errors: Readonly<{
    description?: string;
    servings?: string;
    title?: string;
  }>;
  onDescriptionChange: (value: string) => void;
  onServingsChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  servings: string;
  title: string;
}

export function RecipeDraftDetailsSection({
  description,
  disabled,
  errors,
  onDescriptionChange,
  onServingsChange,
  onTitleChange,
  servings,
  title,
}: RecipeDraftDetailsSectionProps) {
  return (
    <fieldset className="draft-editor__section" disabled={disabled}>
      <legend>Recipe details</legend>
      <p className="draft-editor__help">A private draft may be untitled and incomplete.</p>
      <div className="draft-editor__details-grid">
        <div className="recipe-form-field draft-editor__title-field">
          <label htmlFor="draft-title">Title</label>
          <input id="draft-title" value={title} maxLength={200} aria-invalid={Boolean(errors.title)} aria-describedby={errors.title ? "draft-title-error" : undefined} onChange={(event) => onTitleChange(event.target.value)} />
          <RecipeDraftFieldError id="draft-title-error" message={errors.title} />
        </div>
        <div className="recipe-form-field">
          <label htmlFor="draft-servings">Servings</label>
          <input id="draft-servings" value={servings} inputMode="decimal" aria-invalid={Boolean(errors.servings)} aria-describedby={errors.servings ? "draft-servings-error" : undefined} onChange={(event) => onServingsChange(event.target.value)} />
          <RecipeDraftFieldError id="draft-servings-error" message={errors.servings} />
        </div>
        <div className="recipe-form-field draft-editor__description-field">
          <label htmlFor="draft-description">Description</label>
          <textarea id="draft-description" value={description} maxLength={2000} rows={4} aria-invalid={Boolean(errors.description)} aria-describedby={errors.description ? "draft-description-error" : undefined} onChange={(event) => onDescriptionChange(event.target.value)} />
          <RecipeDraftFieldError id="draft-description-error" message={errors.description} />
        </div>
      </div>
    </fieldset>
  );
}
