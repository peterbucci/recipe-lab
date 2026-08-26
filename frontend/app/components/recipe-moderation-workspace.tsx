"use client";

import Link from "next/link";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";

import { createIdempotencyKey } from "../../lib/idempotency-key";
import {
  browseRecipeModerationCases,
  fetchRecipeModerationCase,
  MODERATION_PRIVATE_NOTE_MAX_LENGTH,
  moderateRecipeCase,
  type RecipeModerationAction,
  RecipeModerationApiError,
  type RecipeModerationCaseDetail,
  type RecipeModerationCasePage,
  type RecipeModerationStatus,
  type RecipeModerationVisibility,
} from "../../lib/recipe-moderation-api";
import type { RecipeReportReason } from "../../lib/recipe-report-api";
import { useAuthSession } from "./auth-session-provider";

const STATUS_FILTERS: ReadonlyArray<{ value: RecipeModerationStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
];

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

function isAbortError(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === "AbortError";
}

function formatTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return value;
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(parsed);
}

function unavailablePage() {
  return (
    <main id="main-content" className="state-page">
      <div className="error-state" role="alert">
        <p className="eyebrow">Page unavailable</p>
        <h1>We couldn’t find that page.</h1>
        <p>Browse the recipe collection to find something to cook.</p>
        <Link className="button button--primary" href="/recipes">
          Browse recipes
        </Link>
      </div>
    </main>
  );
}

export function RecipeModerationWorkspace() {
  const { state, refreshSession } = useAuthSession();
  const [authorizationLost, setAuthorizationLost] = useState(false);

  const handleAuthorizationLost = useCallback(() => {
    setAuthorizationLost(true);
    void refreshSession();
  }, [refreshSession]);

  if (state.phase === "loading") {
    return (
      <main id="main-content" className="state-page">
        <div className="loading-state" role="status" aria-live="polite">
          <span className="loading-state__pulse" aria-hidden="true" />
          <strong>Checking moderation access…</strong>
          <span>Loading your account permissions.</span>
        </div>
      </main>
    );
  }
  if (state.phase === "error") {
    return (
      <main id="main-content" className="state-page">
        <div className="error-state" role="alert">
          <p className="eyebrow">Account unavailable</p>
          <h1>We couldn’t check access.</h1>
          <p>Try checking your account again, or return to the recipe collection.</p>
          <div className="button-row">
            <button className="button button--primary" type="button" onClick={() => void refreshSession()}>
              Try again
            </button>
            <Link className="button button--secondary" href="/recipes">
              Browse recipes
            </Link>
          </div>
        </div>
      </main>
    );
  }
  if (
    authorizationLost ||
    state.session.status !== "authenticated" ||
    !state.session.capabilities?.moderate_recipe_reports
  ) {
    return unavailablePage();
  }
  return <AuthorizedModerationWorkspace onAuthorizationLost={handleAuthorizationLost} />;
}

interface Attempt {
  fingerprint: string;
  idempotencyKey: string;
}

function AuthorizedModerationWorkspace({
  onAuthorizationLost,
}: {
  onAuthorizationLost: () => void;
}) {
  const [caseStatus, setCaseStatus] = useState<RecipeModerationStatus>("open");
  const [page, setPage] = useState(1);
  const [queue, setQueue] = useState<RecipeModerationCasePage | null>(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [queueError, setQueueError] = useState("");
  const [queueReload, setQueueReload] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<RecipeModerationCaseDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [detailReload, setDetailReload] = useState(0);
  const [privateNote, setPrivateNote] = useState("");
  const [actionPending, setActionPending] = useState<RecipeModerationAction | null>(null);
  const [actionError, setActionError] = useState("");
  const [workspaceStatus, setWorkspaceStatus] = useState("");
  const statusRef = useRef<HTMLParagraphElement>(null);
  const actionErrorRef = useRef<HTMLDivElement>(null);
  const actionAttempt = useRef<Attempt | null>(null);

  function selectCase(recipeVersionId: string | null) {
    selectedIdRef.current = recipeVersionId;
    setSelectedId(recipeVersionId);
    setDetail(null);
    setDetailLoading(recipeVersionId !== null);
    setDetailError("");
    setPrivateNote("");
    setActionError("");
    actionAttempt.current = null;
  }

  function reloadQueue() {
    setQueueLoading(true);
    setQueueError("");
    setQueueReload((value) => value + 1);
  }

  function reloadDetail() {
    if (selectedId) setDetailLoading(true);
    setDetailError("");
    setDetailReload((value) => value + 1);
  }

  useEffect(() => {
    const controller = new AbortController();
    void browseRecipeModerationCases({
      status: caseStatus,
      page,
      pageSize: 20,
      signal: controller.signal,
    })
      .then((result) => {
        setQueue(result);
        setQueueError("");
        const current = selectedIdRef.current;
        const next =
          current && result.items.some((item) => item.recipe_version_id === current)
            ? current
            : (result.items[0]?.recipe_version_id ?? null);
        if (next !== current) selectCase(next);
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason)) return;
        setQueue(null);
        selectCase(null);
        if (reason instanceof RecipeModerationApiError && reason.status === 403) {
          onAuthorizationLost();
          return;
        }
        setQueueError("The recipe-report queue could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setQueueLoading(false);
      });
    return () => controller.abort();
  }, [caseStatus, onAuthorizationLost, page, queueReload]);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    void fetchRecipeModerationCase(selectedId, controller.signal)
      .then((result) => {
        setDetail(result);
        setDetailError("");
      })
      .catch((reason: unknown) => {
        if (isAbortError(reason)) return;
        if (reason instanceof RecipeModerationApiError && reason.status === 403) {
          onAuthorizationLost();
          return;
        }
        setDetailError("This moderation case could not be loaded. Please try again.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [detailReload, onAuthorizationLost, selectedId]);

  async function applyAction(action: RecipeModerationAction) {
    if (!selectedId || actionPending) return;
    const note = privateNote.trim() || null;
    const fingerprint = JSON.stringify({ selectedId, action, note });
    if (actionAttempt.current?.fingerprint !== fingerprint) {
      actionAttempt.current = { fingerprint, idempotencyKey: createIdempotencyKey() };
    }
    setActionPending(action);
    setActionError("");
    setWorkspaceStatus("");
    try {
      const result = await moderateRecipeCase(
        selectedId,
        action,
        note,
        actionAttempt.current.idempotencyKey,
      );
      setPrivateNote("");
      actionAttempt.current = null;
      setWorkspaceStatus(
        `${action === "hide" ? "Recipe hidden" : action === "restore" ? "Recipe restored" : "Case resolved"}. The moderation record was updated.`,
      );
      setDetail((current) =>
        current
          ? { ...current, status: result.case_status, visibility_state: result.visibility_state }
          : current,
      );
      setQueueReload((value) => value + 1);
      setDetailReload((value) => value + 1);
      window.setTimeout(() => statusRef.current?.focus(), 0);
    } catch (reason) {
      if (reason instanceof RecipeModerationApiError && reason.status === 403) {
        onAuthorizationLost();
        return;
      }
      const message =
        reason instanceof RecipeModerationApiError && reason.status === 409
          ? "This case changed before your action completed. Your private note is still here; reload the case and review its current state."
          : reason instanceof RecipeModerationApiError
            ? reason.message
            : "Recipe Lab could not complete this moderation action. Please try again.";
      setActionError(message);
      window.setTimeout(() => actionErrorRef.current?.focus(), 0);
    } finally {
      setActionPending(null);
    }
  }

  return (
    <main id="main-content" className="page-shell moderation-workspace">
      <header className="moderation-workspace__header">
        <div>
          <p className="eyebrow">Private moderator workspace</p>
          <h1>Recipe reports</h1>
          <p>Review aggregate cases without exposing who submitted a report.</p>
        </div>
        <Link href="/community-rules">Community rules</Link>
      </header>

      <div className="moderation-workspace__filters" role="group" aria-label="Filter moderation cases">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={caseStatus === filter.value}
            onClick={() => {
              setQueueLoading(true);
              setQueueError("");
              setCaseStatus(filter.value);
              setPage(1);
              selectCase(null);
            }}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {queueError ? (
        <div className="form-alert" role="alert">
          <p>{queueError}</p>
          <button className="button button--secondary" type="button" onClick={reloadQueue}>
            Retry queue
          </button>
        </div>
      ) : null}

      <div className="moderation-workspace__layout">
        <section className="moderation-queue" aria-labelledby="moderation-queue-title">
          <div className="moderation-section-heading">
            <h2 id="moderation-queue-title">{caseStatus === "open" ? "Open" : "Resolved"} cases</h2>
            <span>{queue?.total ?? 0} total</span>
          </div>
          {queueLoading ? (
            <p role="status">Loading recipe-report cases…</p>
          ) : queue?.items.length ? (
            <ul>
              {queue.items.map((item) => (
                <li key={item.recipe_version_id}>
                  <button
                    type="button"
                    aria-current={selectedId === item.recipe_version_id ? "true" : undefined}
                    onClick={() => selectCase(item.recipe_version_id)}
                  >
                    <strong>{item.title}</strong>
                    <span>By {item.author.display_name}</span>
                    <span>
                      {item.reporter_count} {item.reporter_count === 1 ? "reporter" : "reporters"}
                    </span>
                    <small>Last report {formatTime(item.last_reported_at)}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p>No {caseStatus} recipe-report cases.</p>
          )}
          {queue && queue.total_pages > 1 ? (
            <nav className="pagination" aria-label="Moderation queue pages">
              <button
                className="button button--quiet"
                type="button"
                disabled={page <= 1 || queueLoading}
                onClick={() => {
                  setQueueLoading(true);
                  setQueueError("");
                  setPage((value) => Math.max(1, value - 1));
                }}
              >
                Previous
              </button>
              <span>Page {queue.page} of {queue.total_pages}</span>
              <button
                className="button button--quiet"
                type="button"
                disabled={page >= queue.total_pages || queueLoading}
                onClick={() => {
                  setQueueLoading(true);
                  setQueueError("");
                  setPage((value) => value + 1);
                }}
              >
                Next
              </button>
            </nav>
          ) : null}
        </section>

        <section className="moderation-detail" aria-labelledby="moderation-detail-title">
          {!selectedId ? (
            <div className="moderation-detail__empty">
              <h2 id="moderation-detail-title">Select a case</h2>
              <p>Choose a recipe-report case to review its de-identified evidence.</p>
            </div>
          ) : detailLoading && !detail ? (
            <div role="status">
              <h2 id="moderation-detail-title">Loading case…</h2>
            </div>
          ) : detailError ? (
            <div className="form-alert" role="alert">
              <h2 id="moderation-detail-title">Case unavailable</h2>
              <p>{detailError}</p>
              <button className="button button--secondary" type="button" onClick={reloadDetail}>
                Retry case
              </button>
            </div>
          ) : detail ? (
            <CaseDetail
              detail={detail}
              privateNote={privateNote}
              actionPending={actionPending}
              actionError={actionError}
              actionErrorRef={actionErrorRef}
              onPrivateNoteChange={(value) => {
                setPrivateNote(value);
                setActionError("");
              }}
              onAction={(action) => void applyAction(action)}
              onReload={reloadDetail}
            />
          ) : null}
        </section>
      </div>
      <p className="moderation-workspace__status" role="status" aria-live="polite" tabIndex={-1} ref={statusRef}>
        {workspaceStatus}
      </p>
    </main>
  );
}

function CaseDetail({
  detail,
  privateNote,
  actionPending,
  actionError,
  actionErrorRef,
  onPrivateNoteChange,
  onAction,
  onReload,
}: {
  detail: RecipeModerationCaseDetail;
  privateNote: string;
  actionPending: RecipeModerationAction | null;
  actionError: string;
  actionErrorRef: RefObject<HTMLDivElement | null>;
  onPrivateNoteChange: (value: string) => void;
  onAction: (action: RecipeModerationAction) => void;
  onReload: () => void;
}) {
  return (
    <>
      <header className="moderation-detail__header">
        <p className="eyebrow">{detail.status === "open" ? "Open case" : "Resolved case"}</p>
        <h2 id="moderation-detail-title">{detail.title}</h2>
        <p>By {detail.author.display_name}{detail.author.handle ? ` (@${detail.author.handle})` : ""}</p>
        <dl className="moderation-detail__facts">
          <div><dt>Visibility</dt><dd>{VISIBILITY_LABELS[detail.visibility_state]}</dd></div>
          <div><dt>Reporters</dt><dd>{detail.reporter_count}</dd></div>
          <div><dt>Opened</dt><dd>{formatTime(detail.opened_at)}</dd></div>
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
            <li key={item.reason}><span>{REASON_LABELS[item.reason]}</span><strong>{item.count}</strong></li>
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
              <time dateTime={report.submitted_at}>{formatTime(report.submitted_at)}</time>
              {report.details ? <p>{report.details}</p> : <p className="field-help">No additional details.</p>}
            </li>
          ))}
        </ol>
      </section>

      <section className="moderation-actions" aria-labelledby="moderation-actions-title">
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
          <small>{privateNote.length}/{MODERATION_PRIVATE_NOTE_MAX_LENGTH}</small>
        </div>
        {actionError ? (
          <div className="form-alert" role="alert" tabIndex={-1} ref={actionErrorRef}>
            <p>{actionError}</p>
            <button className="button button--quiet" type="button" onClick={onReload}>Reload case</button>
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
        {detail.history_truncated ? <p className="field-help">Showing the 100 most recent actions.</p> : null}
        {detail.history.length ? (
          <ol className="moderation-history">
            {detail.history.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.action === "hide" ? "Recipe hidden" : entry.action === "restore" ? "Recipe restored" : "Case resolved"}</strong>
                <span>By {entry.actor.display_name} · {formatTime(entry.occurred_at)}</span>
                <span>{VISIBILITY_LABELS[entry.visibility_state]} · {entry.status}</span>
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
