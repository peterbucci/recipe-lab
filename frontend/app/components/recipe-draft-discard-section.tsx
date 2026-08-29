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
    <section className="draft-editor__danger" aria-labelledby="discard-draft-title">
      <h2 id="discard-draft-title">Discard this draft</h2>
      <p>{DISCARD_COPY}</p>
      {!confirming ? <button className="button button--quiet" type="button" disabled={disabled} onClick={onRequest}>Discard draft…</button> : (
        <div className="draft-discard">
          <p><strong>Are you sure?</strong></p>
          <div className="button-row">
            <button className="button button--danger" type="button" disabled={disabled} onClick={() => void onConfirm()}>{discarding ? "Discarding…" : "Discard permanently"}</button>
            <button className="button button--secondary" type="button" disabled={disabled} onClick={onCancel}>Keep draft</button>
          </div>
        </div>
      )}
    </section>
  );
}
