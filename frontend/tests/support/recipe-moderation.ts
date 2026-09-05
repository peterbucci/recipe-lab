import type {
  RecipeModerationCaseDetail,
  RecipeModerationCasePage,
  RecipeModerationCaseSummary,
} from "../../lib/recipe-moderation-api";

export const RECIPE_ID = "11111111-1111-4111-8111-111111111111";
export const SECOND_RECIPE_ID = "55555555-5555-4555-8555-555555555555";
export const MODERATOR_ID = "44444444-4444-4444-8444-444444444444";
export const NOW = "2026-08-26T12:00:00Z";

const AUTHOR_ID = "22222222-2222-4222-8222-222222222222";
const REPORT_ID = "33333333-3333-4333-8333-333333333333";

export const moderationSummary: RecipeModerationCaseSummary = {
  recipe_version_id: RECIPE_ID,
  title: "Reported soup",
  author: { id: AUTHOR_ID, handle: "cook", display_name: "Recipe Cook" },
  status: "open",
  visibility_state: "published",
  reporter_count: 2,
  opened_at: NOW,
  last_reported_at: NOW,
  resolved_at: null,
};

export const secondModerationSummary: RecipeModerationCaseSummary = {
  ...moderationSummary,
  recipe_version_id: SECOND_RECIPE_ID,
  title: "Flagged noodles",
  author: {
    id: "66666666-6666-4666-8666-666666666666",
    handle: "noodle-cook",
    display_name: "Noodle Cook",
  },
  reporter_count: 1,
};

export function moderationDetail(
  overrides: Partial<RecipeModerationCaseDetail> = {},
): RecipeModerationCaseDetail {
  return {
    ...moderationSummary,
    reason_counts: [
      { reason: "spam", count: 1 },
      { reason: "dangerous_content", count: 1 },
    ],
    reports: [
      {
        id: REPORT_ID,
        reason: "spam",
        details: "Repeated affiliate links",
        submitted_at: NOW,
      },
    ],
    reports_total: 1,
    reports_truncated: false,
    history: [
      {
        id: 1,
        action: "restore",
        previous_status: "open",
        status: "open",
        visibility_state: "published",
        private_note: "Previous private note",
        occurred_at: NOW,
        actor: {
          id: MODERATOR_ID,
          handle: "morgan",
          display_name: "Morgan Moderator",
        },
      },
    ],
    history_total: 1,
    history_truncated: false,
    ...overrides,
  };
}

export function moderationPage(
  items: RecipeModerationCaseSummary[] = [moderationSummary],
  overrides: Partial<RecipeModerationCasePage> = {},
): RecipeModerationCasePage {
  return {
    items,
    page: 1,
    page_size: 20,
    total: items.length,
    total_pages: items.length ? 1 : 0,
    ...overrides,
  };
}
