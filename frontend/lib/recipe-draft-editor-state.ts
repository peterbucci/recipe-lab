import type { RecipeDraftDetail } from "./recipe-draft-api";
import {
  recipeDraftFingerprint,
  type RecipeDraftEditorState,
  type RecipeDraftIngredientState,
  type RecipeDraftInstructionState,
} from "./recipe-draft";
import {
  appendDraftIngredient,
  appendDraftInstruction,
  moveDraftIngredient,
  moveDraftInstruction,
  removeDraftIngredient,
  removeDraftInstruction,
  replaceDraftIngredient,
  replaceDraftInstruction,
} from "./recipe-draft-editor-transforms";

export interface DraftSaveAttempt {
  fingerprint: string;
  idempotencyKey: string;
  revision: number;
}

export type DraftFailureKind =
  | "authentication-interruption"
  | "ambiguous-result"
  | "failed-retryable"
  | "revision-conflict";

export type DraftWorkSlice =
  | { status: "unavailable" }
  | {
      baselineFingerprint: string;
      detail: RecipeDraftDetail;
      draft: RecipeDraftEditorState;
      status: "clean" | "dirty";
    };

export type DraftSaveSlice =
  | { attempt: DraftSaveAttempt | null; status: "idle" }
  | { attempt: DraftSaveAttempt; status: "saving" }
  | { newerLocalWork: boolean; status: "saved" }
  | { attempt: DraftSaveAttempt; status: DraftFailureKind };

export type DraftEditorNotice = "loaded-latest" | "none";

export interface DraftValidationSlice {
  fieldErrors: Record<string, string>;
  formError: string;
}

export interface RecipeDraftEditorDomainState {
  notice: DraftEditorNotice;
  save: DraftSaveSlice;
  validation: DraftValidationSlice;
  work: DraftWorkSlice;
}

type DraftTextField =
  | "activeTimeMinutes"
  | "description"
  | "notes"
  | "servings"
  | "title"
  | "totalTimeMinutes";

export type RecipeDraftEditorEvent =
  | {
      detail: RecipeDraftDetail;
      draft: RecipeDraftEditorState;
      mode: "initial" | "replacement";
      type: "draft-loaded";
    }
  | { draft: RecipeDraftEditorState; type: "draft-changed" }
  | { attempt: DraftSaveAttempt; type: "save-started" }
  | {
      attemptId: string;
      detail: RecipeDraftDetail;
      draft: RecipeDraftEditorState;
      type: "save-succeeded";
    }
  | {
      attemptId: string;
      kind: DraftFailureKind;
      type: "save-failed";
    }
  | { type: "reload-skipped-newer-work" }
  | { field: DraftTextField; type: "text-field-changed"; value: string }
  | {
      type: "difficulty-changed";
      value: RecipeDraftEditorState["difficulty"];
    }
  | {
      categories: RecipeDraftEditorState["categories"];
      type: "categories-changed";
    }
  | { ingredient: RecipeDraftIngredientState; type: "ingredient-added" }
  | {
      ingredient: RecipeDraftIngredientState;
      key: string;
      type: "ingredient-replaced";
    }
  | { index: number; type: "ingredient-removed" }
  | { direction: -1 | 1; index: number; type: "ingredient-moved" }
  | { instruction: RecipeDraftInstructionState; type: "instruction-added" }
  | {
      instruction: RecipeDraftInstructionState;
      key: string;
      type: "instruction-replaced";
    }
  | { index: number; type: "instruction-removed" }
  | { direction: -1 | 1; index: number; type: "instruction-moved" }
  | {
      fieldErrors: Record<string, string>;
      formError: string;
      type: "validation-applied";
    }
  | { type: "validation-cleared" };

export const initialRecipeDraftEditorDomainState: RecipeDraftEditorDomainState =
  {
    notice: "none",
    save: { attempt: null, status: "idle" },
    validation: { fieldErrors: {}, formError: "" },
    work: { status: "unavailable" },
  };

function saveAttempt(state: DraftSaveSlice): DraftSaveAttempt | null {
  return "attempt" in state ? state.attempt : null;
}

export function prepareDraftSaveAttempt(
  state: RecipeDraftEditorDomainState,
  input: {
    fingerprint: string;
    newIdempotencyKey: string;
    revision: number;
  },
): DraftSaveAttempt {
  const previous = saveAttempt(state.save);
  if (
    previous?.fingerprint === input.fingerprint &&
    previous.revision === input.revision
  ) {
    return previous;
  }
  return {
    fingerprint: input.fingerprint,
    idempotencyKey: input.newIdempotencyKey,
    revision: input.revision,
  };
}

export function recipeDraftEditorIsDirty(
  state: RecipeDraftEditorDomainState,
): boolean {
  return state.work.status === "dirty";
}

function changeDraft(
  state: RecipeDraftEditorDomainState,
  draft: RecipeDraftEditorState,
): RecipeDraftEditorDomainState {
  if (state.work.status === "unavailable" || state.work.draft === draft) {
    return state;
  }
  const dirty =
    recipeDraftFingerprint(draft) !== state.work.baselineFingerprint;
  return {
    ...state,
    notice: "none",
    save:
      state.save.status === "saving"
        ? state.save
        : { attempt: saveAttempt(state.save), status: "idle" },
    validation: { ...state.validation, formError: "" },
    work: {
      ...state.work,
      draft,
      status: dirty ? "dirty" : "clean",
    },
  };
}

export function recipeDraftEditorReducer(
  state: RecipeDraftEditorDomainState,
  event: RecipeDraftEditorEvent,
): RecipeDraftEditorDomainState {
  switch (event.type) {
    case "draft-loaded":
      return {
        notice: event.mode === "replacement" ? "loaded-latest" : "none",
        save: { attempt: saveAttempt(state.save), status: "idle" },
        validation: { fieldErrors: {}, formError: "" },
        work: {
          baselineFingerprint: recipeDraftFingerprint(event.draft),
          detail: event.detail,
          draft: event.draft,
          status: "clean",
        },
      };

    case "draft-changed": {
      return changeDraft(state, event.draft);
    }

    case "text-field-changed":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(state, {
            ...state.work.draft,
            [event.field]: event.value,
          });

    case "difficulty-changed":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(state, {
            ...state.work.draft,
            difficulty: event.value,
          });

    case "categories-changed":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(state, {
            ...state.work.draft,
            categories: event.categories,
          });

    case "ingredient-added":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(
            state,
            appendDraftIngredient(state.work.draft, event.ingredient),
          );

    case "ingredient-replaced":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(
            state,
            replaceDraftIngredient(
              state.work.draft,
              event.key,
              event.ingredient,
            ),
          );

    case "ingredient-removed":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(
            state,
            removeDraftIngredient(state.work.draft, event.index),
          );

    case "ingredient-moved":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(
            state,
            moveDraftIngredient(
              state.work.draft,
              event.index,
              event.direction,
            ),
          );

    case "instruction-added":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(
            state,
            appendDraftInstruction(state.work.draft, event.instruction),
          );

    case "instruction-replaced":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(
            state,
            replaceDraftInstruction(
              state.work.draft,
              event.key,
              event.instruction,
            ),
          );

    case "instruction-removed":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(
            state,
            removeDraftInstruction(state.work.draft, event.index),
          );

    case "instruction-moved":
      return state.work.status === "unavailable"
        ? state
        : changeDraft(
            state,
            moveDraftInstruction(
              state.work.draft,
              event.index,
              event.direction,
            ),
          );

    case "save-started":
      if (state.work.status === "unavailable") return state;
      return {
        ...state,
        notice: "none",
        save: { attempt: event.attempt, status: "saving" },
      };

    case "save-succeeded": {
      if (
        state.work.status === "unavailable" ||
        state.save.status !== "saving" ||
        state.save.attempt.idempotencyKey !== event.attemptId
      ) {
        return state;
      }
      const hasNewerLocalWork =
        recipeDraftFingerprint(state.work.draft) !==
        state.save.attempt.fingerprint;
      const savedFingerprint = recipeDraftFingerprint(event.draft);
      return {
        ...state,
        notice: "none",
        save: { newerLocalWork: hasNewerLocalWork, status: "saved" },
        validation: { fieldErrors: {}, formError: "" },
        work: {
          baselineFingerprint: savedFingerprint,
          detail: event.detail,
          draft: hasNewerLocalWork ? state.work.draft : event.draft,
          status: hasNewerLocalWork ? "dirty" : "clean",
        },
      };
    }

    case "save-failed":
      if (
        state.save.status !== "saving" ||
        state.save.attempt.idempotencyKey !== event.attemptId
      ) {
        return state;
      }
      return {
        ...state,
        notice: "none",
        save: { attempt: state.save.attempt, status: event.kind },
      };

    case "reload-skipped-newer-work":
      return { ...state, notice: "none" };

    case "validation-applied":
      return {
        ...state,
        validation: {
          fieldErrors: event.fieldErrors,
          formError: event.formError,
        },
      };

    case "validation-cleared":
      return {
        ...state,
        validation: { fieldErrors: {}, formError: "" },
      };
  }
}
