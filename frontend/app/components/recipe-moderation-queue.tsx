import type {
  RecipeModerationCasePage,
  RecipeModerationStatus,
} from "../../lib/recipe-moderation-api";
import { formatModerationTime } from "./use-recipe-moderation-workspace";

interface RecipeModerationQueueProps {
  caseStatus: RecipeModerationStatus;
  page: number;
  queue: RecipeModerationCasePage | null;
  queueLoading: boolean;
  selectedId: string | null;
  onNextPage: () => void;
  onPreviousPage: () => void;
  onSelectCase: (recipeVersionId: string) => void;
}

export function RecipeModerationQueue({
  caseStatus,
  page,
  queue,
  queueLoading,
  selectedId,
  onNextPage,
  onPreviousPage,
  onSelectCase,
}: RecipeModerationQueueProps) {
  return (
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
                onClick={() => onSelectCase(item.recipe_version_id)}
              >
                <strong>{item.title}</strong>
                <span>By {item.author.display_name}</span>
                <span>
                  {item.reporter_count} {item.reporter_count === 1 ? "reporter" : "reporters"}
                </span>
                <small>Last report {formatModerationTime(item.last_reported_at)}</small>
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
            onClick={onPreviousPage}
          >
            Previous
          </button>
          <span>Page {queue.page} of {queue.total_pages}</span>
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
