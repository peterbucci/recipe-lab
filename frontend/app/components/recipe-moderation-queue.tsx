import type {
  RecipeModerationCasePage,
  RecipeModerationCaseSummary,
  RecipeModerationStatus,
} from "../../lib/recipe-moderation-api";
import {
  formatModerationTime,
  RECIPE_MODERATION_STATUS_LABELS,
} from "../../lib/recipe-moderation-presentation";
import { WorkspacePagination } from "./workspace-pagination";
import { WorkspaceLoadingState } from "./workspace-state";

interface RecipeModerationQueueProps {
  caseStatus: RecipeModerationStatus;
  queue: RecipeModerationCasePage | null;
  queueLoading: boolean;
  searchQuery: string;
  selectedId: string | null;
  visibleItems: ReadonlyArray<RecipeModerationCaseSummary>;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onSearchQueryChange: (value: string) => void;
  onSelectCase: (recipeVersionId: string) => void;
}

export function RecipeModerationQueue({
  caseStatus,
  queue,
  queueLoading,
  searchQuery,
  selectedId,
  visibleItems,
  onNextPage,
  onPreviousPage,
  onSearchQueryChange,
  onSelectCase,
}: RecipeModerationQueueProps) {
  return (
    <section
      className="staff-panel-surface staff-sticky-queue staff-workspace__queue moderation-queue"
      aria-labelledby="moderation-queue-title"
      aria-busy={queueLoading}
    >
      <div className="moderation-section-heading">
        <h2 id="moderation-queue-title">
          {RECIPE_MODERATION_STATUS_LABELS[caseStatus]} cases
        </h2>
        <span>
          {queue
            ? `${queue.total} ${queue.total === 1 ? "case" : "cases"}`
            : ""}
        </span>
      </div>
      <label className="moderation-queue__search">
        <span className="visually-hidden">Search these cases</span>
        <input
          type="search"
          value={searchQuery}
          placeholder="Search these cases"
          autoComplete="off"
          onChange={(event) => onSearchQueryChange(event.target.value)}
        />
      </label>
      {queueLoading ? (
        <WorkspaceLoadingState
          count={5}
          label="Loading recipe-report cases…"
          layout="rows"
          refreshing={Boolean(queue)}
        />
      ) : null}
      {visibleItems.length ? (
        <ul
          className="staff-workspace__queue-list"
          aria-label={`${RECIPE_MODERATION_STATUS_LABELS[caseStatus]} cases`}
        >
          {visibleItems.map((item) => (
            <li key={item.recipe_version_id}>
              <button
                className={
                  selectedId === item.recipe_version_id
                    ? "moderation-queue__case moderation-queue__case--selected"
                    : "moderation-queue__case"
                }
                type="button"
                aria-current={
                  selectedId === item.recipe_version_id ? "true" : undefined
                }
                onClick={() => onSelectCase(item.recipe_version_id)}
              >
                <strong>{item.title}</strong>
                <span>
                  By {item.author.display_name}
                  {item.author.handle ? ` (@${item.author.handle})` : ""}
                </span>
                <small>
                  {item.reporter_count}{" "}
                  {item.reporter_count === 1 ? "reporter" : "reporters"}
                  {" · "}
                  Last report {formatModerationTime(item.last_reported_at)}
                </small>
              </button>
            </li>
          ))}
        </ul>
      ) : !queueLoading && queue ? (
        <p className="moderation-queue__empty">
          {searchQuery.trim()
            ? "No cases match your search on this page."
            : `No ${caseStatus} recipe-report cases.`}
        </p>
      ) : null}
      {queue ? (
        <WorkspacePagination
          buttonClassName="button button--quiet"
          className="staff-workspace__pagination"
          currentPage={queue.page}
          label="Moderation queue pages"
          loading={queueLoading}
          nextLabel="Next"
          previousLabel="Previous"
          totalPages={queue.total_pages}
          renderControl={({ direction, ...control }) => (
            <button
              className={control.className}
              type="button"
              disabled={control.disabled}
              onClick={direction === "previous" ? onPreviousPage : onNextPage}
            >
              {control.label}
            </button>
          )}
        />
      ) : null}
    </section>
  );
}
