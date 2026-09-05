"use client";

import type { operations } from "./api-contracts/generated";
import { browserApiRequest } from "./api-transport/browser";
import {
  ApiTransportError,
  createRequestFingerprint,
  type PublicApiErrorContract,
} from "./api-transport/core";
import { parseRecipeSummary } from "./recipe-library-api";

type FollowCookOperation = operations["follow_cook_api_cooks__handle__follow_put"];
type MyFollowStatsOperation = operations["my_follow_stats_api_my_follow_stats_get"];
type MyFollowersOperation = operations["my_followers_api_my_followers_get"];
type MyCommunityActivityOperation =
  operations["my_community_activity_api_my_community_activity_get"];

export type CookFollowState =
  FollowCookOperation["responses"][200]["content"]["application/json"];
export type MyFollowStats =
  MyFollowStatsOperation["responses"][200]["content"]["application/json"];
export type MyFollowersPage =
  MyFollowersOperation["responses"][200]["content"]["application/json"];
export type MemberFollower = MyFollowersPage["items"][number];
export type FollowerReference = MemberFollower["follower"];
export type MyCommunityActivityPage =
  MyCommunityActivityOperation["responses"][200]["content"]["application/json"];

export interface FetchMyFollowersOptions {
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

export interface FetchMyCommunityActivityOptions {
  page?: number;
  pageSize?: number;
  signal?: AbortSignal;
}

const FOLLOW_ERROR_CONTRACT: PublicApiErrorContract = {
  fallbackCode: "member_follow_api_error",
  knownCodes: new Set([
    "abuse_protection_unavailable",
    "account_setup_required",
    "authentication_required",
    "cannot_follow_self",
    "cook_not_found",
    "invalid_csrf",
    "rate_limit_exceeded",
    "validation_error",
  ]),
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 1;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function parseFollowerReference(value: unknown): FollowerReference | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    !UUID_PATTERN.test(value.id) ||
    typeof value.display_name !== "string" ||
    value.display_name.trim().length === 0 ||
    value.display_name.length > 120
  ) {
    return null;
  }
  if (
    value.handle !== null &&
    (typeof value.handle !== "string" ||
      !/^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])$/.test(value.handle))
  ) {
    return null;
  }
  return {
    id: value.id,
    handle: value.handle as string | null,
    display_name: value.display_name,
  };
}

function invalidResponse(): MemberFollowApiError {
  return new MemberFollowApiError(
    "Recipe Lab received an invalid follower response. Please try again.",
    502,
    "invalid_member_follow_response",
  );
}

function errorMessage(status: number): string {
  if (status === 401) return "Your session expired. Sign in again to continue.";
  if (status === 403) return "Recipe Lab could not verify this follow request.";
  if (status === 404) return "This cook is no longer available.";
  if (status === 409) return "You cannot follow your own account.";
  if (status === 429) return "Too many follow requests were made. Please wait and try again.";
  return "Recipe Lab could not update this follow right now.";
}

export class MemberFollowApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "member_follow_api_error") {
    super(message);
    this.name = "MemberFollowApiError";
    this.status = status;
    this.code = code;
  }
}

function fromTransportError(error: ApiTransportError): MemberFollowApiError {
  return new MemberFollowApiError(
    errorMessage(error.status),
    error.status,
    error.code,
  );
}

export function parseCookFollowState(value: unknown): CookFollowState {
  if (
    !isRecord(value) ||
    typeof value.cook_id !== "string" ||
    !UUID_PATTERN.test(value.cook_id) ||
    typeof value.following !== "boolean" ||
    !isNonnegativeInteger(value.follower_count)
  ) {
    throw invalidResponse();
  }
  return {
    cook_id: value.cook_id,
    following: value.following,
    follower_count: value.follower_count,
  };
}

export function parseMyFollowStats(value: unknown): MyFollowStats {
  if (
    !isRecord(value) ||
    !isNonnegativeInteger(value.follower_count) ||
    !isNonnegativeInteger(value.following_count)
  ) {
    throw invalidResponse();
  }
  return {
    follower_count: value.follower_count,
    following_count: value.following_count,
  };
}

export function parseMyFollowersPage(value: unknown): MyFollowersPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.page_size) ||
    value.page_size > 100 ||
    !isNonnegativeInteger(value.total) ||
    !isNonnegativeInteger(value.total_pages) ||
    value.items.length > value.page_size ||
    value.total_pages !== Math.ceil(value.total / value.page_size)
  ) {
    throw invalidResponse();
  }

  const items = value.items.map((item): MemberFollower | null => {
    if (!isRecord(item) || !isTimestamp(item.followed_at)) return null;
    const follower = parseFollowerReference(item.follower);
    return follower ? { follower, followed_at: item.followed_at } : null;
  });
  if (items.some((item) => item === null)) throw invalidResponse();
  return {
    items: items as MemberFollower[],
    page: value.page,
    page_size: value.page_size,
    total: value.total,
    total_pages: value.total_pages,
  };
}

export function parseMyCommunityActivityPage(
  value: unknown,
): MyCommunityActivityPage {
  if (
    !isRecord(value) ||
    !Array.isArray(value.items) ||
    !isPositiveInteger(value.page) ||
    !isPositiveInteger(value.page_size) ||
    value.page_size > 100 ||
    !isNonnegativeInteger(value.total) ||
    !isNonnegativeInteger(value.total_pages) ||
    value.items.length > value.page_size ||
    value.total_pages !== Math.ceil(value.total / value.page_size)
  ) {
    throw invalidResponse();
  }
  const items = value.items.map(parseRecipeSummary);
  if (items.some((item) => item === null)) throw invalidResponse();
  return {
    items: items as MyCommunityActivityPage["items"],
    page: value.page,
    page_size: value.page_size,
    total: value.total,
    total_pages: value.total_pages,
  };
}

export async function fetchCookFollowState(
  handle: string,
  signal?: AbortSignal,
): Promise<CookFollowState> {
  try {
    const response = await browserApiRequest(
      `/api/cooks/${encodeURIComponent(handle)}/follow`,
      {
        errorContract: FOLLOW_ERROR_CONTRACT,
        kind: "query",
        signal,
      },
    );
    return parseCookFollowState(response.data);
  } catch (error) {
    if (error instanceof MemberFollowApiError) throw error;
    if (error instanceof ApiTransportError) throw fromTransportError(error);
    throw new MemberFollowApiError(
      "Recipe Lab could not load this follow right now.",
      0,
    );
  }
}

export async function setCookFollowing(
  handle: string,
  following: boolean,
  idempotencyKey: string,
): Promise<CookFollowState> {
  try {
    const requestFingerprint = await createRequestFingerprint({
      following,
      handle: handle.trim().toLowerCase(),
    });
    const response = await browserApiRequest(
      `/api/cooks/${encodeURIComponent(handle)}/follow`,
      {
        csrf: "member",
        errorContract: FOLLOW_ERROR_CONTRACT,
        identity: { idempotencyKey, requestFingerprint },
        kind: "mutation",
        method: following ? "PUT" : "DELETE",
      },
    );
    return parseCookFollowState(response.data);
  } catch (error) {
    if (error instanceof MemberFollowApiError) throw error;
    if (error instanceof ApiTransportError) throw fromTransportError(error);
    throw new MemberFollowApiError(
      "Recipe Lab could not update this follow right now.",
      0,
    );
  }
}

export async function fetchMyFollowStats(
  signal?: AbortSignal,
): Promise<MyFollowStats> {
  try {
    const response = await browserApiRequest("/api/my/follow-stats", {
      errorContract: FOLLOW_ERROR_CONTRACT,
      kind: "query",
      signal,
    });
    return parseMyFollowStats(response.data);
  } catch (error) {
    if (error instanceof MemberFollowApiError) throw error;
    if (error instanceof ApiTransportError) throw fromTransportError(error);
    throw new MemberFollowApiError(
      "Recipe Lab could not load your followers right now.",
      0,
    );
  }
}

export async function fetchMyFollowers({
  page = 1,
  pageSize = 20,
  signal,
}: FetchMyFollowersOptions = {}): Promise<MyFollowersPage> {
  if (!isPositiveInteger(page) || page > 1_000_000) {
    throw new RangeError("Follower page must be between 1 and 1,000,000.");
  }
  if (!isPositiveInteger(pageSize) || pageSize > 100) {
    throw new RangeError("Follower page size must be between 1 and 100.");
  }

  try {
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    const response = await browserApiRequest(`/api/my/followers?${query}`, {
      errorContract: FOLLOW_ERROR_CONTRACT,
      kind: "query",
      signal,
    });
    return parseMyFollowersPage(response.data);
  } catch (error) {
    if (error instanceof MemberFollowApiError) throw error;
    if (error instanceof ApiTransportError) {
      const translated = fromTransportError(error);
      throw new MemberFollowApiError(
        translated.status === 401
          ? translated.message
          : "Recipe Lab could not load your followers right now.",
        translated.status,
        translated.code,
      );
    }
    throw new MemberFollowApiError(
      "Recipe Lab could not load your followers right now.",
      0,
    );
  }
}

export async function fetchMyCommunityActivity({
  page = 1,
  pageSize = 20,
  signal,
}: FetchMyCommunityActivityOptions = {}): Promise<MyCommunityActivityPage> {
  if (!isPositiveInteger(page) || page > 1_000_000) {
    throw new RangeError("Community activity page must be between 1 and 1,000,000.");
  }
  if (!isPositiveInteger(pageSize) || pageSize > 100) {
    throw new RangeError("Community activity page size must be between 1 and 100.");
  }

  try {
    const query = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    const response = await browserApiRequest(
      `/api/my/community-activity?${query}`,
      {
        errorContract: FOLLOW_ERROR_CONTRACT,
        kind: "query",
        signal,
      },
    );
    return parseMyCommunityActivityPage(response.data);
  } catch (error) {
    if (error instanceof MemberFollowApiError) throw error;
    if (error instanceof ApiTransportError) {
      const translated = fromTransportError(error);
      throw new MemberFollowApiError(
        translated.status === 401
          ? translated.message
          : "Recipe Lab could not load your community activity right now.",
        translated.status,
        translated.code,
      );
    }
    throw new MemberFollowApiError(
      "Recipe Lab could not load your community activity right now.",
      0,
    );
  }
}
