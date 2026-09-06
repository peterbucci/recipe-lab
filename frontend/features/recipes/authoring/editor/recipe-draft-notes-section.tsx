import { RecipeDraftFieldError } from "./recipe-draft-field-error";

interface RecipeDraftNotesSectionProps {
  disabled: boolean;
  error?: string;
  notes: string;
  onChange: (value: string) => void;
}

export function RecipeDraftNotesSection({
  disabled,
  error,
  notes,
  onChange,
}: RecipeDraftNotesSectionProps) {
  return (
    <fieldset
      className="draft-editor__section recipe-detail__notes recipe-workspace__notes"
      disabled={disabled}
    >
      <legend className="visually-hidden">Recipe notes</legend>
      <div className="section-heading section-heading--compact">
        <div>
          <h2>Notes</h2>
        </div>
      </div>
      <p className="draft-editor__help recipe-workspace__section-help">
        Add notes that should appear with this recipe when it is published.
      </p>
      <div className="recipe-form-field draft-editor__notes-field">
        <label className="visually-hidden" htmlFor="draft-notes">
          Recipe notes
        </label>
        <textarea
          id="draft-notes"
          className="recipe-workspace__editable-text"
          value={notes}
          maxLength={5000}
          rows={8}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "draft-notes-error" : undefined}
          placeholder="Add substitutions, serving ideas, or anything another cook should know."
          onChange={(event) => onChange(event.target.value)}
        />
        <RecipeDraftFieldError id="draft-notes-error" message={error} />
      </div>
    </fieldset>
  );
}
