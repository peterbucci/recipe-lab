import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  clearRecipeDraftCreationAttempt,
  getOrCreateRecipeDraftCreationAttempt,
  recipeDraftCreationAttemptStorageKey,
  recipeDraftCreationIntent,
} from "./recipe-draft-creation-attempt";

const SOURCE_ID = "11111111-1111-4111-8111-111111111111";
const ACTION_ID = "22222222-2222-4222-8222-222222222222";
const NEXT_ACTION_ID = "33333333-3333-4333-8333-333333333333";

function storedAttempt(
  actorId: string,
  sourceVersionId: string | null,
  actionId: string,
) {
  return {
    actor_id: actorId,
    idempotency_key: actionId,
    intent: recipeDraftCreationIntent(sourceVersionId),
    version: 1 as const,
  };
}

describe("recipe draft creation attempts", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it("reuses the exact versioned actor-and-intent record", () => {
    const storageKey = recipeDraftCreationAttemptStorageKey(
      "member-a",
      SOURCE_ID,
    );
    const attempt = storedAttempt("member-a", SOURCE_ID, ACTION_ID);
    window.sessionStorage.setItem(storageKey, JSON.stringify(attempt));

    expect(
      getOrCreateRecipeDraftCreationAttempt("member-a", SOURCE_ID),
    ).toEqual(attempt);
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null")).toEqual(
      attempt,
    );
  });

  it("canonicalizes source casing and isolates actors and creation intents", () => {
    expect(
      recipeDraftCreationAttemptStorageKey("member-a", SOURCE_ID.toUpperCase()),
    ).toBe(recipeDraftCreationAttemptStorageKey("member-a", SOURCE_ID));
    expect(recipeDraftCreationAttemptStorageKey("member-a", null)).not.toBe(
      recipeDraftCreationAttemptStorageKey("member-a", SOURCE_ID),
    );
    expect(recipeDraftCreationAttemptStorageKey("member-b", SOURCE_ID)).not.toBe(
      recipeDraftCreationAttemptStorageKey("member-a", SOURCE_ID),
    );
  });

  it("replaces an invalid record before any request can use it", () => {
    const storageKey = recipeDraftCreationAttemptStorageKey(
      "member-a",
      SOURCE_ID,
    );
    window.sessionStorage.setItem(
      storageKey,
      JSON.stringify({ idempotency_key: "borrowed-or-invalid" }),
    );
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(NEXT_ACTION_ID);

    const attempt = getOrCreateRecipeDraftCreationAttempt(
      "member-a",
      SOURCE_ID,
    );

    expect(attempt).toEqual(
      storedAttempt("member-a", SOURCE_ID, NEXT_ACTION_ID),
    );
    expect(JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null")).toEqual(
      attempt,
    );
  });

  it("clears only the matching action after its draft is known", () => {
    const storageKey = recipeDraftCreationAttemptStorageKey(
      "member-a",
      SOURCE_ID,
    );
    const current = storedAttempt("member-a", SOURCE_ID, ACTION_ID);
    window.sessionStorage.setItem(storageKey, JSON.stringify(current));

    clearRecipeDraftCreationAttempt(
      storedAttempt("member-a", SOURCE_ID, NEXT_ACTION_ID),
      SOURCE_ID,
    );
    expect(window.sessionStorage.getItem(storageKey)).not.toBeNull();

    clearRecipeDraftCreationAttempt(current, SOURCE_ID);
    expect(window.sessionStorage.getItem(storageKey)).toBeNull();
  });
});
