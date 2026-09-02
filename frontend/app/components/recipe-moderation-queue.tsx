import type {
  RecipeModerationCasePage,
  RecipeModerationCaseSummary,
  RecipeModerationStatus,
} from "../../lib/recipe-moderation-api";
import { formatModerationTime } from "./use-recipe-moderation-workspace";
import { SectionLoading } from "./loading-ui";

interface RecipeModerationQueueProps {
  caseStatus: RecipeModerationStatus;
  page: number;
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
  page,
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
          {caseStatus === "open" ? "Open" : "Resolved"} cases
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
        <SectionLoading
          count={5}
          label="Loading recipe-report cases…"
          layout="rows"
          refreshing={Boolean(queue)}
        />
      ) : null}
      {visibleItems.length ? (
        <ul
          className="staff-workspace__queue-list"
          aria-label={`${caseStatus === "open" ? "Open" : "Resolved"} cases`}
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
      {queue && queue.total_pages > 1 ? (
        <nav
          className="staff-workspace__pagination pagination"
          aria-label="Moderation queue pages"
        >
          <button
            className="button button--quiet"
            type="button"
            disabled={page <= 1 || queueLoading}
            onClick={onPreviousPage}
          >
            Previous
          </button>
          <span>
            Page {queue.page} of {queue.total_pages}
          </span>
          <button
            className="button button--quiet"
            type="button"
            disabled={page >= queue.total_pages || queueLoading}
            onClick={onNextPage}
          >
            Next
          </button>
        </nav>
      ) : null}
    </section>
  );
}
