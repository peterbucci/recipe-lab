"use client";

import { createIdempotencyKey } from "./idempotency-key";

export const RECIPE_DRAFT_CREATION_ATTEMPT_STORAGE_PREFIX =
  "recipe-lab:draft-creation-attempt:v1";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RecipeDraftCreationAttempt {
  actor_id: string;
  idempotency_key: string;
  intent: string;
  version: 1;
}

export class RecipeDraftCreationAttemptError extends Error {
  readonly code = "draft_creation_attempt_unavailable";

  constructor() {
    super(
      "Recipe Lab could not safely prepare this private draft. Try again to recover the same draft.",
    );
    this.name = "RecipeDraftCreationAttemptError";
  }
}

export function recipeDraftCreationIntent(
  sourceVersionId: string | null,
): string {
  return sourceVersionId === null
    ? "blank"
    : `source:${sourceVersionId.toLowerCase()}`;
}

export function recipeDraftCreationAttemptStorageKey(
  actorId: string,
  sourceVersionId: string | null,
): string {
  const intent = recipeDraftCreationIntent(sourceVersionId);
  return `${RECIPE_DRAFT_CREATION_ATTEMPT_STORAGE_PREFIX}:${encodeURIComponent(actorId)}:${encodeURIComponent(intent)}`;
}

function isAttempt(
  value: unknown,
  actorId: string,
  intent: string,
): value is RecipeDraftCreationAttempt {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const attempt = value as Record<string, unknown>;
  return (
    Object.keys(attempt).length === 4 &&
    attempt.version === 1 &&
    attempt.actor_id === actorId &&
    attempt.intent === intent &&
    typeof attempt.idempotency_key === "string" &&
    UUID_PATTERN.test(attempt.idempotency_key)
  );
}

function readAttempt(
  storage: Storage,
  storageKey: string,
  actorId: string,
  intent: string,
): RecipeDraftCreationAttempt | null {
  const stored = storage.getItem(storageKey);
  if (stored === null) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    return isAttempt(parsed, actorId, intent) ? parsed : null;
  } catch {
    return null;
  }
}

export function getOrCreateRecipeDraftCreationAttempt(
  actorId: string,
  sourceVersionId: string | null,
): RecipeDraftCreationAttempt {
  if (typeof actorId !== "string" || actorId.trim().length === 0) {
    throw new RecipeDraftCreationAttemptError();
  }
  const intent = recipeDraftCreationIntent(sourceVersionId);
  const storageKey = recipeDraftCreationAttemptStorageKey(
    actorId,
    sourceVersionId,
  );

  try {
    const storage = window.sessionStorage;
    const existing = readAttempt(storage, storageKey, actorId, intent);
    if (existing) return existing;

    const attempt: RecipeDraftCreationAttempt = {
      actor_id: actorId,
      idempotency_key: createIdempotencyKey(),
      intent,
      version: 1,
    };
    storage.setItem(storageKey, JSON.stringify(attempt));
    return attempt;
  } catch {
    throw new RecipeDraftCreationAttemptError();
  }
}

export function clearRecipeDraftCreationAttempt(
  attempt: RecipeDraftCreationAttempt,
  sourceVersionId: string | null,
): void {
  const storageKey = recipeDraftCreationAttemptStorageKey(
    attempt.actor_id,
    sourceVersionId,
  );
  try {
    const storage = window.sessionStorage;
    const current = readAttempt(
      storage,
      storageKey,
      attempt.actor_id,
      attempt.intent,
    );
    if (current?.idempotency_key === attempt.idempotency_key) {
      storage.removeItem(storageKey);
    }
  } catch {
    // A known draft ID is safe to open even if storage cleanup is unavailable.
    // Replaying the retained key later resolves to that same draft.
  }
}
