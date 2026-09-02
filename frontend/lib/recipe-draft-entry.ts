"use client";

import {
  clearRecipeDraftCreationAttempt,
  getOrCreateRecipeDraftCreationAttempt,
  RecipeDraftCreationAttemptError,
} from "./recipe-draft-creation-attempt";
import {
  createRecipeDraft,
  fetchRecipeDraft,
  findActiveRecipeDraftForSource,
  RecipeDraftApiError,
  type RecipeDraftDetail,
} from "./recipe-draft-api";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertDraftId(draftId: string): string {
  if (!UUID_PATTERN.test(draftId)) {
    throw new RecipeDraftApiError(
      "Recipe Lab could not confirm the private draft. Try again to recover the same draft.",
      502,
      "invalid_recipe_draft_response",
      [],
      "unknown",
    );
  }
  return draftId;
}

export function recipeDraftEntryErrorMessage(reason: unknown): string {
  if (
    reason instanceof RecipeDraftApiError ||
    reason instanceof RecipeDraftCreationAttemptError
  ) {
    return reason.message;
  }
  return "Recipe Lab could not start this private draft. Try again to recover the same draft.";
}

async function createRecipeDraftWithRecovery(
  actorId: string,
  sourceVersionId: string | null,
): Promise<RecipeDraftDetail> {
  let terminalConflictRecovered = false;
  while (true) {
    const attempt = getOrCreateRecipeDraftCreationAttempt(actorId, sourceVersionId);
    try {
      const draft = await createRecipeDraft(sourceVersionId, attempt.idempotency_key);
      assertDraftId(draft.id);
      clearRecipeDraftCreationAttempt(attempt, sourceVersionId);
      return draft;
    } catch (reason) {
      const terminalConflict =
        reason instanceof RecipeDraftApiError &&
        reason.code === "idempotency_key_conflict";
      if (!terminalConflict) throw reason;

      clearRecipeDraftCreationAttempt(attempt, sourceVersionId);
      if (terminalConflictRecovered) throw reason;
      terminalConflictRecovered = true;
    }
  }
}

export async function startOrResumeRecipeDraftDetail(
  actorId: string,
  sourceVersionId: string | null,
): Promise<RecipeDraftDetail> {
  if (sourceVersionId !== null) {
    const activeDraft = await findActiveRecipeDraftForSource(sourceVersionId);
    if (activeDraft !== null) {
      return fetchRecipeDraft(assertDraftId(activeDraft.id));
    }
  }

  return createRecipeDraftWithRecovery(actorId, sourceVersionId);
}

export async function startOrResumeRecipeDraft(
  actorId: string,
  sourceVersionId: string | null,
): Promise<string> {
  if (sourceVersionId !== null) {
    const activeDraft = await findActiveRecipeDraftForSource(sourceVersionId);
    if (activeDraft !== null) return assertDraftId(activeDraft.id);
  }

  return assertDraftId(
    (await createRecipeDraftWithRecovery(actorId, sourceVersionId)).id,
  );
}
