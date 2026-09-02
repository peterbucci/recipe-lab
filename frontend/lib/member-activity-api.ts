"use client";

import type { operations } from "./api-contracts/generated";
import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  type PublicApiErrorContract,
} from "./api-transport/core";
import type { MemberActivity } from "./member-activity";
import {
  parseRecipeDraftListItem,
  type RecipeDraftListItem,
} from "./recipe-draft-api";

type ActivityOperation =
  operations["my_member_activity_api_my_activity_get"];
type ActivityContract =
  ActivityOperation["responses"][200]["content"]["application/json"];
type ActivityContractItem = ActivityContract["items"][number];
type DashboardOperation =
  operations["my_member_dashboard_api_my_dashboard_get"];
type DashboardContract =
  DashboardOperation["responses"][200]["content"]["application/json"];

export type MemberActivityFilter = ActivityContract["selected_filter"];

export interface MemberActivityCounts {
  all: number;
  recipes: number;
  requests: number;
  saved: number;
}

export interface MemberActivityPage {
  counts: MemberActivityCounts;
  items: MemberActivity[];
  nextCursor: string | null;
  selectedFilter: MemberActivityFilter;
}

export interface MemberDashboard {
  latestDraft: RecipeDraftListItem | null;
  recentActivity: MemberActivity[];
  stats: {
    activeDrafts: number;
    followers: number;
    savedRecipes: number;
    versionsPublished: number;
  };
}

const ACTIVITY_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "member_activity_api_error",
  knownCodes: new Set([
    "abuse_protection_unavailable",
    "account_setup_required",
    "authentication_required",
    "invalid_activity_cursor",
    "rate_limit_exceeded",
    "validation_error",
  ]),
};

export class MemberActivityApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status: number, code = "member_activity_api_error") {
    super(message);
    this.name = "MemberActivityApiError";
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function invalidResponse(): MemberActivityApiError {
  return new MemberActivityApiError(
    "Recipe Lab could not load your activity. Please try again.",
    502,
    "invalid_member_activity_response",
  );
}

function requestLabel(state: ActivityContractItem["state"]): string {
  if (state === "approved") return "Ingredient request approved";
  if (state === "duplicate") return "Ingredient request matched";
  if (state === "rejected") return "Ingredient request rejected";
  return "Ingredient request reviewed";
}

function requestDetail(state: ActivityContractItem["state"]): string {
  if (state === "approved") return "The ingredient is now available in the catalog.";
  if (state === "duplicate") {
    return "A matching ingredient is already available in the catalog.";
  }
  return "A curator reviewed this request.";
}

function isActivityContractItem(value: unknown): value is ActivityContractItem {
  if (
    !isRecord(value) ||
    !isUuid(value.id) ||
    typeof value.title !== "string" ||
    value.title.length > 200 ||
    !isTimestamp(value.occurred_at)
  ) {
    return false;
  }
  if (value.kind === "draft" || value.kind === "saved") {
    return value.state === undefined || value.state === null;
  }
  if (value.kind === "published") {
    return value.state === "published" || value.state === "moderation_hidden";
  }
  if (value.kind === "withdrawn") return value.state === "author_withdrawn";
  return (
    value.kind === "ingredient-request" &&
    (value.state === "approved" ||
      value.state === "duplicate" ||
      value.state === "rejected")
  );
}

function activityFromContract(item: ActivityContractItem): MemberActivity {
  const title = item.title.trim() || "Untitled recipe";
  if (item.kind === "draft") {
    return {
      href: `/recipes/drafts/${item.id}`,
      id: `draft:${item.id}`,
      kind: "draft",
      label: "Updated draft",
      timestamp: item.occurred_at,
      title,
    };
  }
  if (item.kind === "published") {
    return {
      detail:
        item.state === "moderation_hidden"
          ? "Currently hidden by moderation"
          : undefined,
      href: "/account/recipes?view=published",
      id: `published:${item.id}`,
      kind: "published",
      label: "Published recipe version",
      timestamp: item.occurred_at,
      title,
    };
  }
  if (item.kind === "withdrawn") {
    return {
      detail: "This recipe is no longer publicly available.",
      href: "/account/recipes?view=withdrawn",
      id: `withdrawn:${item.id}`,
      kind: "withdrawn",
      label: "Published recipe version",
      timestamp: item.occurred_at,
      title,
    };
  }
  if (item.kind === "saved") {
    return {
      href: "/account/recipes?view=saved",
      id: `saved:${item.id}`,
      kind: "saved",
      label: "Saved recipe",
      timestamp: item.occurred_at,
      title,
    };
  }
  return {
    detail: requestDetail(item.state),
    href: "/account/ingredient-requests",
    id: `ingredient-request:${item.id}`,
    kind: "ingredient-request",
    label: requestLabel(item.state),
    timestamp: item.occurred_at,
    title,
  };
}

function parseCounts(value: unknown): MemberActivityCounts | null {
  if (
    !isRecord(value) ||
    !isCount(value.all) ||
    !isCount(value.recipes) ||
    !isCount(value.requests) ||
    !isCount(value.saved) ||
    value.all !== value.recipes + value.requests + value.saved
  ) {
    return null;
  }
  return {
    all: value.all,
    recipes: value.recipes,
    requests: value.requests,
    saved: value.saved,
  };
}

function isDashboardStats(
  value: unknown,
): value is DashboardContract["stats"] {
  return (
    isRecord(value) &&
    isCount(value.active_drafts) &&
    isCount(value.followers) &&
    isCount(value.saved_recipes) &&
    isCount(value.versions_published)
  );
}

function parseActivities(value: unknown, maximum: number): MemberActivity[] | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  if (!value.every(isActivityContractItem)) return null;
  return value.map(activityFromContract);
}

export function parseMemberActivityPage(value: unknown): MemberActivityPage {
  if (!isRecord(value)) throw invalidResponse();
  const items = parseActivities(value.items, 100);
  const counts = parseCounts(value.counts);
  const selectedFilter = value.selected_filter;
  const nextCursor = value.next_cursor;
  if (
    !items ||
    !counts ||
    (selectedFilter !== "all" &&
      selectedFilter !== "recipes" &&
      selectedFilter !== "requests" &&
      selectedFilter !== "saved") ||
    (nextCursor !== null &&
      (typeof nextCursor !== "string" ||
        nextCursor.length === 0 ||
        nextCursor.length > 512 ||
        !/^[A-Za-z0-9_-]+$/.test(nextCursor)))
  ) {
    throw invalidResponse();
  }
  return { counts, items, nextCursor, selectedFilter };
}

export function parseMemberDashboard(value: unknown): MemberDashboard {
  if (!isRecord(value) || !isDashboardStats(value.stats)) {
    throw invalidResponse();
  }
  const latestDraft =
    value.latest_draft === null
      ? null
      : parseRecipeDraftListItem(value.latest_draft);
  const recentActivity = parseActivities(value.recent_activity, 3);
  const stats = value.stats;
  if (
    (value.latest_draft !== null && latestDraft === null) ||
    !recentActivity
  ) {
    throw invalidResponse();
  }
  return {
    latestDraft,
    recentActivity,
    stats: {
      activeDrafts: stats.active_drafts,
      followers: stats.followers,
      savedRecipes: stats.saved_recipes,
      versionsPublished: stats.versions_published,
    },
  };
}

function errorMessage(status: number): string {
  if (status === 401) return "Your session expired. Sign in again to load your activity.";
  if (status === 403) return "Your activity is not available to this account.";
  if (status === 429) return "Too many requests. Please wait before refreshing your activity.";
  return "Recipe Lab could not load your activity. Please try again.";
}

function fromTransportError(error: ApiTransportError): MemberActivityApiError {
  if (error.reason === "invalid_response") return invalidResponse();
  return new MemberActivityApiError(
    errorMessage(error.status),
    error.status,
    error.code,
  );
}

async function activityQuery(path: string, signal?: AbortSignal): Promise<unknown> {
  try {
    return (
      await browserApiRequest(path, {
        errorContract: ACTIVITY_ERROR_CONTRACT,
        kind: "query",
        signal,
      })
    ).data;
  } catch (error) {
    if (error instanceof ApiTransportError) throw fromTransportError(error);
    throw new MemberActivityApiError(errorMessage(0), 0);
  }
}

export async function fetchMemberActivity({
  cursor,
  filter = "all",
  pageSize = 24,
  q,
  signal,
}: {
  cursor?: string | null;
  filter?: MemberActivityFilter;
  pageSize?: number;
  q?: string;
  signal?: AbortSignal;
} = {}): Promise<MemberActivityPage> {
  const query = new URLSearchParams({
    filter,
    page_size: String(pageSize),
  });
  const search = q?.trim();
  if (search) query.set("q", search);
  if (cursor) query.set("cursor", cursor);
  const result = parseMemberActivityPage(
    await activityQuery(`/api/my/activity?${query.toString()}`, signal),
  );
  if (result.selectedFilter !== filter) throw invalidResponse();
  return result;
}

export async function fetchMemberDashboard(
  signal?: AbortSignal,
): Promise<MemberDashboard> {
  return parseMemberDashboard(await activityQuery("/api/my/dashboard", signal));
}
