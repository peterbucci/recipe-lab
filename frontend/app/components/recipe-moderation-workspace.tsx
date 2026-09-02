"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import type { RecipeModerationStatus } from "../../lib/recipe-moderation-api";
import { RECIPE_MODERATION_STATUS_LABELS } from "../../lib/recipe-moderation-presentation";
import { useAuthSession } from "./auth-session-provider";
import { AuthGateLoading } from "./loading-ui";
import { RecipeModerationCaseDetail } from "./recipe-moderation-case-detail";
import { RecipeModerationQueue } from "./recipe-moderation-queue";
import { useRecipeModerationWorkspace } from "./use-recipe-moderation-workspace";
import { WorkspaceEmptyState } from "./workspace-empty-state";
import { WorkspacePanelHeader } from "./workspace-panel-header";
import {
  WorkspaceErrorState,
  WorkspaceLoadingState,
} from "./workspace-state";
import {
  WorkspaceTabButton,
  WorkspaceTabMenu,
} from "./workspace-tab-menu";

const STATUS_FILTERS: ReadonlyArray<{
  value: RecipeModerationStatus;
  label: string;
}> = [
  { value: "open", label: RECIPE_MODERATION_STATUS_LABELS.open },
  { value: "resolved", label: RECIPE_MODERATION_STATUS_LABELS.resolved },
];

const STATUS_PANEL_COPY: Record<
  RecipeModerationStatus,
  { description: string; emptyDescription: string; emptyTitle: string; title: string }
> = {
  open: {
    description: "Cases waiting for a moderation decision.",
    emptyDescription: "New reports will appear here when they need moderator review.",
    emptyTitle: "There are no open recipe-report cases.",
    title: "Open cases",
  },
  resolved: {
    description: "Cases with a completed moderation decision.",
    emptyDescription: "Completed moderation cases will appear here.",
    emptyTitle: "There are no resolved recipe-report cases.",
    title: "Resolved cases",
  },
};

function unavailablePage() {
  return (
    <main
      id="main-content"
      className="state-page staff-state-page staff-state-page--moderation staff-state-page--authorization"
    >
      <div className="error-state staff-state-panel" role="alert">
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
        <AuthGateLoading
          className="staff-state-panel"
          label="Checking moderation access…"
        />
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
          <p>
            Try checking your account again, or return to the recipe collection.
          </p>
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
  return (
    <AuthorizedModerationWorkspace
      onAuthorizationLost={handleAuthorizationLost}
    />
  );
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
  const [queueSearch, setQueueSearch] = useState("");
  const normalizedQueueSearch = queueSearch.trim().toLocaleLowerCase();
  const visibleQueueItems = useMemo(() => {
    const items = queue?.items ?? [];
    if (!normalizedQueueSearch) return items;
    return items.filter((item) =>
      [
        item.title,
        item.author.display_name,
        item.author.handle
          ? `${item.author.handle} @${item.author.handle}`
          : "",
      ]
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQueueSearch),
    );
  }, [normalizedQueueSearch, queue]);
  const visibleSelectedId =
    selectedId &&
    visibleQueueItems.some((item) => item.recipe_version_id === selectedId)
      ? selectedId
      : null;
  const queueIsEmpty = Boolean(
    queue && !queueLoading && !queueError && queue.total === 0,
  );

  return (
    <main
      id="main-content"
      className="page-shell staff-workspace staff-workspace--moderation moderation-workspace"
    >
      <header className="staff-workspace__header moderation-workspace__header">
        <div className="staff-workspace__header-copy">
          <h1>Recipe reports</h1>
          <p>
            Review de-identified reports, manage recipe visibility, and close
            cases when review is complete.
          </p>
        </div>
        <Link
          className="staff-workspace__resource-link"
          href="/community-rules"
        >
          Community rules
        </Link>
      </header>

      <div className="staff-workspace__tab-shell">
        <WorkspaceTabMenu
          className="staff-filter-strip staff-workspace__filters moderation-workspace__filters"
          itemsOnly
          role="group"
          aria-label="Filter moderation cases"
        >
          {STATUS_FILTERS.map((filter) => (
            <WorkspaceTabButton
              key={filter.value}
              className={
                caseStatus === filter.value
                  ? "moderation-workspace__tab moderation-workspace__tab--active"
                  : "moderation-workspace__tab"
              }
              type="button"
              active={caseStatus === filter.value}
              count={
                caseStatus === filter.value && queue && !queueLoading
                  ? queue.total
                  : null
              }
              countClassName="moderation-workspace__tab-count"
              countHidden={false}
              onClick={() => {
                setQueueSearch("");
                changeCaseStatus(filter.value);
              }}
            >
              <span>{filter.label}</span>
            </WorkspaceTabButton>
          ))}
        </WorkspaceTabMenu>
        <WorkspacePanelHeader
          description={STATUS_PANEL_COPY[caseStatus].description}
          meta={
            queue && !queueLoading ? (
              <span aria-live="polite">
                {queue.total} {queue.total === 1 ? "case" : "cases"}
              </span>
            ) : null
          }
          title={STATUS_PANEL_COPY[caseStatus].title}
        />
        {queueIsEmpty ? (
          <WorkspaceEmptyState
            action={
              <button className="button button--primary" type="button" onClick={reloadQueue}>
                Refresh cases
              </button>
            }
            description={STATUS_PANEL_COPY[caseStatus].emptyDescription}
            headingId={`empty-moderation-${caseStatus}`}
            headingLevel={3}
            title={STATUS_PANEL_COPY[caseStatus].emptyTitle}
          />
        ) : null}
      </div>

      {queueError ? (
        <WorkspaceErrorState
          action={<button
            className="button button--secondary"
            type="button"
            onClick={reloadQueue}
          >
            Retry queue
          </button>}
          className="staff-workspace__notice staff-workspace__notice--error form-alert"
          message={queueError}
        />
      ) : null}

      {!queueIsEmpty ? (
        <div className="staff-workspace__layout moderation-workspace__layout">
        <RecipeModerationQueue
          caseStatus={caseStatus}
          queue={queue}
          queueLoading={queueLoading}
          searchQuery={queueSearch}
          selectedId={visibleSelectedId}
          visibleItems={visibleQueueItems}
          onNextPage={goToNextPage}
          onPreviousPage={goToPreviousPage}
          onSearchQueryChange={setQueueSearch}
          onSelectCase={selectCase}
        />

        <section
          className="staff-panel-surface staff-workspace__detail moderation-detail"
          aria-labelledby="moderation-detail-title"
        >
          {!visibleSelectedId ? (
            <div className="moderation-detail__empty">
              <h2 id="moderation-detail-title">
                {normalizedQueueSearch && queue
                  ? "No case selected"
                  : "Select a case"}
              </h2>
              <p>
                {normalizedQueueSearch && queue
                  ? "Choose a matching recipe-report case, or adjust your search."
                  : "Choose a recipe-report case to review its de-identified evidence."}
              </p>
            </div>
          ) : detailLoading && !detail ? (
            <>
              <h2 className="visually-hidden" id="moderation-detail-title">
                Case details
              </h2>
              <WorkspaceLoadingState
                count={1}
                label="Loading case details…"
                layout="panel"
              />
            </>
          ) : detailError ? (
            <div
              className="staff-workspace__notice staff-workspace__notice--error form-alert"
              role="alert"
            >
              <h2 id="moderation-detail-title">Case unavailable</h2>
              <p>{detailError}</p>
              <button
                className="button button--secondary"
                type="button"
                onClick={reloadDetail}
              >
                Retry case
              </button>
            </div>
          ) : detail ? (
            <>
              {detailLoading ? (
                <WorkspaceLoadingState label="Updating case details…" refreshing />
              ) : null}
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
            </>
          ) : null}
        </section>
        </div>
      ) : null}
      {workspaceStatus ? (
        <p
          className="staff-workspace__status moderation-workspace__status"
          role="status"
          aria-live="polite"
          tabIndex={-1}
          ref={statusRef}
        >
          {workspaceStatus}
        </p>
      ) : null}
    </main>
  );
}
