import type { RecipeFieldValue } from "../shared/recipe-contracts";
import type { RecipeComparisonModel } from "./recipe-comparison-model";

interface RecipeComparisonNotesProps {
  comparison: RecipeComparisonModel;
}

const currentEmptyMessage = "No notes were added for this recipe.";
const previousEmptyMessage =
  "No notes were added for the starting recipe.";

function readableNotes(
  value: RecipeFieldValue,
  emptyMessage: string,
): { text: string; empty: boolean } {
  if (typeof value !== "string" || value.trim() === "") {
    return { text: emptyMessage, empty: true };
  }

  return { text: value, empty: false };
}

function NoteValue({
  emptyMessage,
  value,
}: {
  emptyMessage: string;
  value: RecipeFieldValue;
}) {
  const notes = readableNotes(value, emptyMessage);

  return (
    <span
      className={
        notes.empty
          ? "recipe-comparison-notes__value recipe-comparison-notes__value--empty"
          : "recipe-comparison-notes__value"
      }
    >
      {notes.text}
    </span>
  );
}

export function RecipeComparisonNotes({
  comparison,
}: RecipeComparisonNotesProps) {
  const { recipe } = comparison;
  const change = comparison.metadataChanges.notes;

  return (
    <section
      id="recipe-notes"
      className="recipe-comparison-notes"
      aria-labelledby="recipe-comparison-notes-heading"
    >
      <div className="recipe-comparison-section-heading">
        <h2 id="recipe-comparison-notes-heading">
          Notes from {recipe.author.display_name}
        </h2>
        {change ? <small>Notes changed</small> : null}
      </div>

      <div className="recipe-comparison-notes__values">
        <div
          className="recipe-comparison-notes__current"
          data-comparison-value="current"
        >
          <p>
            {change ? (
              <ins>
                <NoteValue
                  value={recipe.notes}
                  emptyMessage={currentEmptyMessage}
                />
              </ins>
            ) : (
              <NoteValue
                value={recipe.notes}
                emptyMessage={currentEmptyMessage}
              />
            )}
          </p>
        </div>

        {change ? (
          <div
            className="recipe-comparison-notes__previous"
            data-comparison-value="previous"
          >
            <span className="recipe-comparison-notes__previous-label">
              Previous
            </span>
            <p>
              <del>
                <NoteValue
                  value={change.before}
                  emptyMessage={previousEmptyMessage}
                />
              </del>
            </p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
