import Link from "next/link";
import type { RefObject } from "react";

import {
  MODERATION_PRIVATE_NOTE_MAX_LENGTH,
  type RecipeModerationAction,
  type RecipeModerationCaseDetail as RecipeModerationCaseDetailData,
  type RecipeModerationVisibility,
} from "../../lib/recipe-moderation-api";
import type { RecipeReportReason } from "../../lib/recipe-report-api";
import {
  formatModerationTime,
  RECIPE_MODERATION_STATUS_LABELS,
} from "../../lib/recipe-moderation-presentation";
import { LoadingButton } from "./loading-ui";

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
        <div className="moderation-detail__heading-row">
          <div className="moderation-detail__title-block">
            <span
              className={`moderation-detail__status-pill moderation-detail__status-pill--${detail.status}`}
            >
              {RECIPE_MODERATION_STATUS_LABELS[detail.status]}
            </span>
            <h2 id="moderation-detail-title">{detail.title}</h2>
            <p className="moderation-detail__author">
              By {detail.author.display_name}
              {detail.author.handle ? ` (@${detail.author.handle})` : ""}
            </p>
          </div>
          {detail.visibility_state === "published" ? (
            <Link
              className="moderation-detail__public-link"
              href={`/recipes/${encodeURIComponent(detail.recipe_version_id)}`}
            >
              Open public recipe
            </Link>
          ) : (
            <span className="moderation-detail__public-state">
              Not publicly available
            </span>
          )}
        </div>
        <dl className="moderation-detail__facts">
          <div>
            <dt>Visibility</dt>
            <dd>
              <span
                className={`moderation-detail__visibility-dot moderation-detail__visibility-dot--${detail.visibility_state}`}
                aria-hidden="true"
              />
              {VISIBILITY_LABELS[detail.visibility_state]}
            </dd>
          </div>
          <div>
            <dt>Reporters</dt>
            <dd>
              {detail.reporter_count}{" "}
              {detail.reporter_count === 1 ? "reporter" : "reporters"}
            </dd>
          </div>
          <div>
            <dt>Opened</dt>
            <dd>{formatModerationTime(detail.opened_at)}</dd>
          </div>
        </dl>
      </header>

      <section
        className="moderation-detail__reported"
        aria-labelledby="moderation-reports-title"
      >
        <div className="moderation-section-heading">
          <h3 id="moderation-reports-title">What was reported</h3>
          <span>
            {detail.reports_total}{" "}
            {detail.reports_total === 1 ? "report" : "reports"}
          </span>
        </div>
        <ul className="moderation-reason-counts" aria-label="Report reasons">
          {detail.reason_counts.map((item) => (
            <li key={item.reason}>
              <span>{REASON_LABELS[item.reason]}</span>
              <strong>{item.count}</strong>
            </li>
          ))}
        </ul>
        {detail.reports_truncated ? (
          <p className="field-help">Showing the 100 most recent reports.</p>
        ) : null}
        {detail.reports.length ? (
          <ol
            className="moderation-evidence-list"
            aria-label="De-identified reports"
          >
            {detail.reports.map((report) => (
              <li key={report.id}>
                <div className="moderation-evidence-list__heading">
                  <strong>{REASON_LABELS[report.reason]}</strong>
                  <time dateTime={report.submitted_at}>
                    {formatModerationTime(report.submitted_at)}
                  </time>
                </div>
                {report.details ? (
                  <p>{report.details}</p>
                ) : (
                  <p className="field-help">No additional details.</p>
                )}
              </li>
            ))}
          </ol>
        ) : (
          <p className="moderation-detail__empty-copy">
            No report details are available.
          </p>
        )}
      </section>

      <section
        className="staff-workspace__decision moderation-actions"
        aria-labelledby="moderation-actions-title"
      >
        <h3 id="moderation-actions-title">Moderation action</h3>
        <p>
          Manage the recipe’s public visibility, or resolve the case when review
          is complete.
        </p>
        <details className="moderation-actions__note">
          <summary>
            <span>Private moderator note</span>
            <span>Optional</span>
          </summary>
          <p>Private notes are visible only to authorized moderators.</p>
          <div className="form-field">
            <label htmlFor="moderation-private-note">
              Private note (optional)
            </label>
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
        </details>
        {actionError ? (
          <div
            className="staff-workspace__notice staff-workspace__notice--error form-alert"
            role="alert"
            tabIndex={-1}
            ref={actionErrorRef}
          >
            <p>{actionError}</p>
            <button
              className="button button--quiet"
              type="button"
              onClick={onReload}
            >
              Reload case
            </button>
          </div>
        ) : null}
        <div className="button-row">
          <LoadingButton
            className="button button--danger"
            type="button"
            disabled={
              detail.visibility_state === "moderation_hidden" ||
              (actionPending !== null && actionPending !== "hide")
            }
            pending={actionPending === "hide"}
            pendingLabel="Hiding recipe…"
            onClick={() => onAction("hide")}
          >
            Hide recipe
          </LoadingButton>
          <LoadingButton
            className="button button--secondary"
            type="button"
            disabled={
              detail.visibility_state !== "moderation_hidden" ||
              (actionPending !== null && actionPending !== "restore")
            }
            pending={actionPending === "restore"}
            pendingLabel="Restoring recipe…"
            onClick={() => onAction("restore")}
          >
            Restore recipe
          </LoadingButton>
          <LoadingButton
            className="button button--secondary"
            type="button"
            disabled={
              detail.status === "resolved" ||
              (actionPending !== null && actionPending !== "resolve")
            }
            pending={actionPending === "resolve"}
            pendingLabel="Resolving case…"
            onClick={() => onAction("resolve")}
          >
            Resolve case
          </LoadingButton>
        </div>
      </section>

      <details className="moderation-history-disclosure">
        <summary>
          <span>Private audit history</span>
          <span>
            {detail.history_total}{" "}
            {detail.history_total === 1 ? "action" : "actions"}
          </span>
        </summary>
        <div className="moderation-history-disclosure__body">
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
                    By {entry.actor.display_name} ·{" "}
                    {formatModerationTime(entry.occurred_at)}
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
        </div>
      </details>
    </>
  );
}
