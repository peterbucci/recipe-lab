"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import type { RecipeModerationStatus } from "../../lib/recipe-moderation-api";
import { useAuthSession } from "./auth-session-provider";
import { RecipeModerationCaseDetail } from "./recipe-moderation-case-detail";
import { RecipeModerationQueue } from "./recipe-moderation-queue";
import { useRecipeModerationWorkspace } from "./use-recipe-moderation-workspace";

const STATUS_FILTERS: ReadonlyArray<{ value: RecipeModerationStatus; label: string }> = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
];

function unavailablePage() {
  return (
    <main
      id="main-content"
      className="state-page staff-state-page staff-state-page--moderation staff-state-page--authorization"
    >
      <div className="error-state staff-state-panel" role="alert">
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
      <main
        id="main-content"
        className="state-page staff-state-page staff-state-page--moderation staff-state-page--loading"
      >
        <div
          className="loading-state staff-state-panel"
          role="status"
          aria-live="polite"
        >
          <span className="loading-state__pulse" aria-hidden="true" />
          <strong>Checking moderation access…</strong>
          <span>Loading your account permissions.</span>
        </div>
      </main>
    );
  }
  if (state.phase === "error") {
    return (
      <main
        id="main-content"
        className="state-page staff-state-page staff-state-page--moderation staff-state-page--error"
      >
        <div className="error-state staff-state-panel" role="alert">
          <p className="eyebrow">Account unavailable</p>
          <h1>We couldn’t check access.</h1>
          <p>Try checking your account again, or return to the recipe collection.</p>
          <div className="button-row">
            <button
              className="button button--primary"
              type="button"
              onClick={() => void refreshSession()}
            >
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

function AuthorizedModerationWorkspace({
  onAuthorizationLost,
}: {
  onAuthorizationLost: () => void;
}) {
  const {
    actionError,
    actionErrorRef,
    actionPending,
    applyAction,
    caseStatus,
    changeCaseStatus,
    changePrivateNote,
    detail,
    detailError,
    detailLoading,
    goToNextPage,
    goToPreviousPage,
    page,
    privateNote,
    queue,
    queueError,
    queueLoading,
    reloadDetail,
    reloadQueue,
    selectCase,
    selectedId,
    statusRef,
    workspaceStatus,
  } = useRecipeModerationWorkspace({ onAuthorizationLost });

  return (
    <main
      id="main-content"
      className="page-shell staff-workspace staff-workspace--moderation moderation-workspace"
    >
      <header className="staff-workspace__header moderation-workspace__header">
        <div className="staff-workspace__header-copy">
          <p className="eyebrow">Private moderator workspace</p>
          <h1>Recipe reports</h1>
          <p>Review aggregate cases without exposing who submitted a report.</p>
        </div>
        <Link className="staff-workspace__resource-link" href="/community-rules">
          Community rules
        </Link>
      </header>

      <div
        className="staff-filter-strip staff-workspace__filters moderation-workspace__filters"
        role="group"
        aria-label="Filter moderation cases"
      >
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            aria-pressed={caseStatus === filter.value}
            onClick={() => changeCaseStatus(filter.value)}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {queueError ? (
        <div
          className="staff-workspace__notice staff-workspace__notice--error form-alert"
          role="alert"
        >
          <p>{queueError}</p>
          <button className="button button--secondary" type="button" onClick={reloadQueue}>
            Retry queue
          </button>
        </div>
      ) : null}

      <div className="staff-workspace__layout moderation-workspace__layout">
        <RecipeModerationQueue
          caseStatus={caseStatus}
          page={page}
          queue={queue}
          queueLoading={queueLoading}
          selectedId={selectedId}
          onNextPage={goToNextPage}
          onPreviousPage={goToPreviousPage}
          onSelectCase={selectCase}
        />

        <section
          className="staff-panel-surface staff-workspace__detail moderation-detail"
          aria-labelledby="moderation-detail-title"
        >
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
            <div
              className="staff-workspace__notice staff-workspace__notice--error form-alert"
              role="alert"
            >
              <h2 id="moderation-detail-title">Case unavailable</h2>
              <p>{detailError}</p>
              <button className="button button--secondary" type="button" onClick={reloadDetail}>
                Retry case
              </button>
            </div>
          ) : detail ? (
            <RecipeModerationCaseDetail
              detail={detail}
              privateNote={privateNote}
              actionPending={actionPending}
              actionError={actionError}
              actionErrorRef={actionErrorRef}
              onPrivateNoteChange={changePrivateNote}
              onAction={(action) => void applyAction(action)}
              onReload={reloadDetail}
            />
          ) : null}
        </section>
      </div>
      <p
        className="staff-workspace__status moderation-workspace__status"
        role="status"
        aria-live="polite"
        tabIndex={-1}
        ref={statusRef}
      >
        {workspaceStatus}
      </p>
    </main>
  );
}
