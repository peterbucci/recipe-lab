import { LoadingButton } from "./loading-ui";

const DISCARD_COPY =
  "Discard permanently deletes this draft and its private content immediately. It cannot be restored.";

interface RecipeDraftDiscardSectionProps {
  confirming: boolean;
  disabled: boolean;
  discarding: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
  onRequest: () => void;
}

export function RecipeDraftDiscardSection({
  confirming,
  disabled,
  discarding,
  onCancel,
  onConfirm,
  onRequest,
}: RecipeDraftDiscardSectionProps) {
  return (
    <section
      className={`draft-editor__danger draft-editor__surface draft-editor__surface--discard${confirming ? " draft-editor__danger--confirming" : ""}`}
      aria-labelledby="discard-draft-title"
    >
      <h2 id="discard-draft-title">Discard this draft</h2>
      <p>{DISCARD_COPY}</p>
      {!confirming ? <button className="button button--quiet" type="button" disabled={disabled} onClick={onRequest}>Discard draft…</button> : (
        <div className="draft-discard">
          <p><strong>Are you sure?</strong></p>
          <div className="button-row">
            <LoadingButton
              className="button button--danger"
              type="button"
              disabled={disabled}
              pending={discarding}
              pendingLabel="Discarding…"
              onClick={() => void onConfirm()}
            >
              Discard permanently
            </LoadingButton>
            <button className="button button--secondary" type="button" disabled={disabled} onClick={onCancel}>Keep draft</button>
          </div>
        </div>
      )}
    </section>
  );
}
