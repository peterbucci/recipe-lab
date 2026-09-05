"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import type { RecipeModerationStatus } from "../../lib/recipe-moderation-api";
import { RECIPE_MODERATION_STATUS_LABELS } from "../../lib/recipe-moderation-presentation";
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
import {
  StaffWorkspaceAccess,
  StaffWorkspaceShell,
  StaffWorkspaceSplitPanel,
} from "./staff-workspace-shell";

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

export function RecipeModerationWorkspace() {
  return (
    <StaffWorkspaceAccess
      capability="moderate_recipe_reports"
      loadingLabel="Checking moderation access…"
      variant="moderation"
    >
      {(onAuthorizationLost) => (
        <AuthorizedModerationWorkspace
          onAuthorizationLost={onAuthorizationLost}
        />
      )}
    </StaffWorkspaceAccess>
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
    <StaffWorkspaceShell
      className="moderation-workspace"
      description="Review de-identified reports, manage recipe visibility, and close cases when review is complete."
      headerAction={
        <Link
          className="staff-workspace__resource-link"
          href="/community-rules"
        >
          Community rules
        </Link>
      }
      headerClassName="moderation-workspace__header"
      title="Recipe reports"
      variant="moderation"
    >

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
        <StaffWorkspaceSplitPanel
          className="moderation-workspace__layout"
          detailClassName="moderation-detail"
          detailHeadingId="moderation-detail-title"
          queue={
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
          }
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
        </StaffWorkspaceSplitPanel>
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
    </StaffWorkspaceShell>
  );
}
