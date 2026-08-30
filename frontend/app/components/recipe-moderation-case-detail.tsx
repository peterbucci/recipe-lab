import Link from "next/link";
import type { RefObject } from "react";

import {
  MODERATION_PRIVATE_NOTE_MAX_LENGTH,
  type RecipeModerationAction,
  type RecipeModerationCaseDetail as RecipeModerationCaseDetailData,
  type RecipeModerationVisibility,
} from "../../lib/recipe-moderation-api";
import type { RecipeReportReason } from "../../lib/recipe-report-api";
import { formatModerationTime } from "./use-recipe-moderation-workspace";

const REASON_LABELS: Record<RecipeReportReason, string> = {
  spam: "Spam or misleading content",
  harassment: "Harassment or hateful content",
  dangerous_content: "Dangerous or illegal content",
  intellectual_property: "Copyright or ownership concern",
  other: "Something else",
};

const VISIBILITY_LABELS: Record<RecipeModerationVisibility, string> = {
  published: "Published",
  author_withdrawn: "Withdrawn by author",
  moderation_hidden: "Hidden by moderation",
};

interface RecipeModerationCaseDetailProps {
  actionError: string;
  actionErrorRef: RefObject<HTMLDivElement | null>;
  actionPending: RecipeModerationAction | null;
  detail: RecipeModerationCaseDetailData;
  privateNote: string;
  onAction: (action: RecipeModerationAction) => void;
  onPrivateNoteChange: (value: string) => void;
  onReload: () => void;
}

export function RecipeModerationCaseDetail({
  detail,
  privateNote,
  actionPending,
  actionError,
  actionErrorRef,
  onPrivateNoteChange,
  onAction,
  onReload,
}: RecipeModerationCaseDetailProps) {
  return (
    <>
      <header className="moderation-detail__header">
        <p className="eyebrow">{detail.status === "open" ? "Open case" : "Resolved case"}</p>
        <h2 id="moderation-detail-title">{detail.title}</h2>
        <p>
          By {detail.author.display_name}
          {detail.author.handle ? ` (@${detail.author.handle})` : ""}
        </p>
        <dl className="moderation-detail__facts">
          <div>
            <dt>Visibility</dt>
            <dd>{VISIBILITY_LABELS[detail.visibility_state]}</dd>
          </div>
          <div>
            <dt>Reporters</dt>
            <dd>{detail.reporter_count}</dd>
          </div>
          <div>
            <dt>Opened</dt>
            <dd>{formatModerationTime(detail.opened_at)}</dd>
          </div>
        </dl>
        {detail.visibility_state === "published" ? (
          <Link href={`/recipes/${encodeURIComponent(detail.recipe_version_id)}`}>
            Open public recipe
          </Link>
        ) : (
          <p className="field-help">This recipe is not available through its public page.</p>
        )}
      </header>

      <section aria-labelledby="moderation-reasons-title">
        <div className="moderation-section-heading">
          <h3 id="moderation-reasons-title">Report reasons</h3>
          <span>{detail.reporter_count} total</span>
        </div>
        <ul className="moderation-reason-counts">
          {detail.reason_counts.map((item) => (
            <li key={item.reason}>
              <span>{REASON_LABELS[item.reason]}</span>
              <strong>{item.count}</strong>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="moderation-reports-title">
        <div className="moderation-section-heading">
          <h3 id="moderation-reports-title">De-identified reports</h3>
          <span>{detail.reports_total} total</span>
        </div>
        {detail.reports_truncated ? (
          <p className="field-help">Showing the 100 most recent reports.</p>
        ) : null}
        <ol className="moderation-evidence-list">
          {detail.reports.map((report) => (
            <li key={report.id}>
              <strong>{REASON_LABELS[report.reason]}</strong>
              <time dateTime={report.submitted_at}>
                {formatModerationTime(report.submitted_at)}
              </time>
              {report.details ? (
                <p>{report.details}</p>
              ) : (
                <p className="field-help">No additional details.</p>
              )}
            </li>
          ))}
        </ol>
      </section>

      <section
        className="staff-workspace__decision moderation-actions"
        aria-labelledby="moderation-actions-title"
      >
        <h3 id="moderation-actions-title">Moderation action</h3>
        <p>Private notes are visible only to authorized moderators.</p>
        <div className="form-field">
          <label htmlFor="moderation-private-note">Private note (optional)</label>
          <textarea
            id="moderation-private-note"
            maxLength={MODERATION_PRIVATE_NOTE_MAX_LENGTH}
            value={privateNote}
            disabled={actionPending !== null}
            onChange={(event) => onPrivateNoteChange(event.target.value)}
          />
          <small>
            {privateNote.length}/{MODERATION_PRIVATE_NOTE_MAX_LENGTH}
          </small>
        </div>
        {actionError ? (
          <div
            className="staff-workspace__notice staff-workspace__notice--error form-alert"
            role="alert"
            tabIndex={-1}
            ref={actionErrorRef}
          >
            <p>{actionError}</p>
            <button className="button button--quiet" type="button" onClick={onReload}>
              Reload case
            </button>
          </div>
        ) : null}
        <div className="button-row">
          <button
            className="button button--danger"
            type="button"
            disabled={detail.visibility_state === "moderation_hidden" || actionPending !== null}
            onClick={() => onAction("hide")}
          >
            {actionPending === "hide" ? "Hiding recipe…" : "Hide recipe"}
          </button>
          <button
            className="button button--secondary"
            type="button"
            disabled={detail.visibility_state !== "moderation_hidden" || actionPending !== null}
            onClick={() => onAction("restore")}
          >
            {actionPending === "restore" ? "Restoring recipe…" : "Restore recipe"}
          </button>
          <button
            className="button button--secondary"
            type="button"
            disabled={detail.status === "resolved" || actionPending !== null}
            onClick={() => onAction("resolve")}
          >
            {actionPending === "resolve" ? "Resolving case…" : "Resolve case"}
          </button>
        </div>
      </section>

      <section aria-labelledby="moderation-history-title">
        <div className="moderation-section-heading">
          <h3 id="moderation-history-title">Private audit history</h3>
          <span>{detail.history_total} actions</span>
        </div>
        {detail.history_truncated ? (
          <p className="field-help">Showing the 100 most recent actions.</p>
        ) : null}
        {detail.history.length ? (
          <ol className="moderation-history">
            {detail.history.map((entry) => (
              <li key={entry.id}>
                <strong>
                  {entry.action === "hide"
                    ? "Recipe hidden"
                    : entry.action === "restore"
                      ? "Recipe restored"
                      : "Case resolved"}
                </strong>
                <span>
                  By {entry.actor.display_name} · {formatModerationTime(entry.occurred_at)}
                </span>
                <span>
                  {VISIBILITY_LABELS[entry.visibility_state]} · {entry.status}
                </span>
                {entry.private_note ? <p>{entry.private_note}</p> : null}
              </li>
            ))}
          </ol>
        ) : (
          <p>No moderator actions have been recorded.</p>
        )}
      </section>
    </>
  );
}
